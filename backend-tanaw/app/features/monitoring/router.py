from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.attractions import attraction_category
from app.features.accounts.dependencies import require_roles
from app.features.accounts.enterprise import (
    enterprise_identifier,
    enterprise_name,
    require_enterprise_profile,
)
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
    SystemConfiguration,
)
from app.features.accounts.opening_hours import local_time
from app.features.activity_logs.service import get_actor_role_label
from app.features.activity_logs.service import record_activity_log as record_operational_log
from app.features.auth.system_settings import load_system_settings_values
from app.features.monitoring.alerts import (
    evaluate_busy_alert,
    evaluate_camera_alerts,
    list_live_alerts,
    live_alerts_by_enterprise,
    record_alert_events,
    resolve_camera_wait_minutes,
    utc_now,
)
from app.features.monitoring.backups import (
    DesktopBackupConflictError,
    get_desktop_backup,
    save_desktop_backup,
)
from app.features.monitoring.live_status import load_current_closures, place_status
from app.features.monitoring.schemas import (
    DesktopBackup,
    DesktopBackupSummary,
    DesktopBackupUpload,
    DesktopConnectionGap,
    DesktopEvent,
    DesktopTelemetryIngest,
    MapEnterpriseAlert,
    MapEnterpriseSummary,
    OperationalAlertSummary,
    TelemetrySnapshotSummary,
    VisitorInsightRange,
    VisitorInsightsSummary,
    VisitorRankingSummary,
)
from app.features.monitoring.telemetry import ingest_telemetry, list_latest_telemetry
from app.features.monitoring.visitor_insights import (
    InvalidInsightRangeError,
    get_visitor_insights,
)
from app.features.monitoring.visitor_ranking import InvalidRankingRangeError, get_visitor_ranking

router = APIRouter(prefix="/operational", tags=["monitoring"])

OperationalReadAccount = Annotated[
    Account, Depends(require_roles({"admin", "it", "staff", "enterprise"}))
]
EnterpriseAccount = Annotated[Account, Depends(require_roles({"enterprise"}))]
AdminAccount = Annotated[Account, Depends(require_roles({"admin"}))]
AlertReadAccount = Annotated[Account, Depends(require_roles({"admin", "it"}))]


async def camera_wait_minutes(db: AsyncSession) -> int:
    record = await db.scalar(select(SystemConfiguration).where(SystemConfiguration.id == "default"))
    return resolve_camera_wait_minutes(load_system_settings_values(record))


@router.post(
    "/desktop/telemetry",
    response_model=TelemetrySnapshotSummary,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_desktop_telemetry(
    payload: DesktopTelemetryIngest,
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> TelemetrySnapshotSummary:
    snapshot = await ingest_telemetry(db, account, payload)
    now = utc_now()
    events = await evaluate_busy_alert(db, account, payload, now=now)
    events += await evaluate_camera_alerts(
        db, account, payload, now=now, wait_minutes=await camera_wait_minutes(db)
    )
    await record_alert_events(db, events)
    return snapshot


@router.post("/desktop/connection-gap", status_code=status.HTTP_204_NO_CONTENT)
async def report_connection_gap(
    payload: DesktopConnectionGap,
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """The desktop app reports, once it reconnects, how long it could not reach TANAW."""
    place = enterprise_name(account)
    start = local_time(payload.startedAt).strftime("%I:%M %p").lstrip("0")
    end = local_time(payload.endedAt).strftime("%I:%M %p").lstrip("0")
    minutes = round((payload.endedAt - payload.startedAt).total_seconds() / 60)
    summary = (
        f"The desktop app at {place} could not connect from {start} to {end} (the app was running)."
        if payload.appRunning
        else f"The desktop app at {place} was closed from {start} to {end}."
    )
    await record_operational_log(
        db,
        group="Monitoring",
        severity="Info",
        actor=place,
        actor_role="Enterprise Account",
        action="Desktop App Offline",
        target=place,
        summary=summary,
        source_id=account.id,
        it_detail=f"Offline for {minutes} minutes. App running: {'yes' if payload.appRunning else 'no'}.",
        metadata={"minutes": minutes, "appRunning": payload.appRunning},
    )


DESKTOP_EVENT_TEXT = {
    "camera_added": ("Add Camera", "added the {camera} camera"),
    "camera_removed": ("Remove Camera", "removed the {camera} camera"),
    "camera_changed": ("Change Camera", "changed the {camera} camera's settings"),
    "counting_area_changed": (
        "Change Counting Area",
        "changed the {camera} camera's counting area",
    ),
    "local_data_reset": ("Reset Desktop Data", "reset the data saved on its computer"),
}


@router.post("/desktop/events", status_code=status.HTTP_204_NO_CONTENT)
async def report_desktop_event(
    payload: DesktopEvent,
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    place = enterprise_name(account)
    action, text = DESKTOP_EVENT_TEXT[payload.type]
    await record_operational_log(
        db,
        group="Settings & Maintenance",
        severity="Warning" if payload.type == "local_data_reset" else "Info",
        actor=place,
        actor_role=get_actor_role_label(account),
        action=action,
        target=place,
        summary=f"{place} {text.format(camera=payload.cameraName or 'a')}.",
        source_id=account.id,
        it_detail=payload.detail,
    )


@router.put(
    "/desktop/backup",
    response_model=DesktopBackupSummary,
    responses={
        status.HTTP_409_CONFLICT: {"description": "The upload was not based on the saved copy."}
    },
)
async def save_enterprise_desktop_backup(
    payload: DesktopBackupUpload,
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DesktopBackupSummary:
    try:
        return await save_desktop_backup(db, account, payload)
    except DesktopBackupConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.get("/desktop/backup", response_model=DesktopBackup | None)
async def get_enterprise_desktop_backup(
    account: EnterpriseAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DesktopBackup | None:
    return await get_desktop_backup(db, account)


@router.get("/visitor-insights", response_model=VisitorInsightsSummary)
async def get_admin_visitor_insights(
    _: AdminAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
    range_value: Annotated[VisitorInsightRange, Query(alias="range")] = "7d",
    enterprise_id: Annotated[str | None, Query(alias="enterpriseId")] = None,
    barangay: str | None = None,
    start: Annotated[
        date | None,
        Query(description="First day, in Philippine time. Chooses the days instead of range."),
    ] = None,
    end: Annotated[
        date | None,
        Query(description="Last day, in Philippine time. Give it together with start."),
    ] = None,
) -> VisitorInsightsSummary:
    if enterprise_id and barangay:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Choose either an establishment or a barangay insight scope.",
        )
    try:
        return await get_visitor_insights(
            db,
            range_value,
            enterprise_id=enterprise_id,
            barangay=barangay,
            start=start,
            end=end,
        )
    except InvalidInsightRangeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.get("/visitor-insights/ranking", response_model=VisitorRankingSummary)
async def get_admin_visitor_ranking(
    _: AdminAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
    start: Annotated[date, Query(description="First day of the range, in Philippine time.")],
    end: Annotated[date, Query(description="Last day of the range, in Philippine time.")],
) -> VisitorRankingSummary:
    """Visitors per enterprise for a date range, from monthly reports and camera counts."""
    try:
        return await get_visitor_ranking(db, start, end)
    except InvalidRankingRangeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@router.get("/map-enterprises", response_model=list[MapEnterpriseSummary])
async def list_map_enterprises(
    account: OperationalReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[MapEnterpriseSummary]:
    latest = {item.enterpriseId: item for item in await list_latest_telemetry(db, account)}
    statement = (
        select(Account)
        .join(Account.enterprise_profile)
        .where(
            Account.role == AccountRole.ENTERPRISE,
            Account.status == AccountStatus.ACTIVE,
            Account.activated_at.is_not(None),
        )
        .order_by(EnterpriseProfile.enterprise_name.asc(), Account.display_name.asc())
    )
    if account.role == AccountRole.ENTERPRISE:
        statement = statement.where(Account.id == account.id)

    accounts = list((await db.scalars(statement)).all())
    now = utc_now()
    closures = await load_current_closures(
        db, [enterprise.id for enterprise in accounts], local_time(now).date()
    )
    alerts = await live_alerts_by_enterprise(db)
    enterprises: list[MapEnterpriseSummary] = []
    for enterprise in accounts:
        profile = require_enterprise_profile(enterprise)
        telemetry = latest.get(enterprise_identifier(enterprise))
        place_alerts = alerts.get(enterprise.id, [])
        live = place_status(profile, closures.get(enterprise.id, []), place_alerts, now)
        enterprises.append(
            MapEnterpriseSummary(
                id=profile.enterprise_id,
                name=profile.enterprise_name,
                barangay=profile.barangay or "Unassigned",
                category=attraction_category(
                    profile.attraction_code, profile.attraction_description
                ),
                fullAddress=profile.address or "Address not provided",
                lat=profile.latitude,
                lng=profile.longitude,
                totalLiveOccupancy=telemetry.currentOccupancy
                if telemetry and telemetry.gatewayStatus == "Connected"
                else None,
                estimatedUniqueCount=telemetry.uniqueCount if telemetry else None,
                monitoringStatus=monitoring_status_from_telemetry(telemetry),
                occupancyStatus=occupancy_status_from_telemetry(
                    telemetry, profile.building_capacity
                ),
                cameraMonitoring=telemetry.monitoring.model_dump() if telemetry else None,
                contact=enterprise.phone or enterprise.email,
                lastSync=telemetry.receivedAt.isoformat() if telemetry else None,
                gatewayStatus=telemetry.gatewayStatus
                if telemetry
                else profile.gateway_status or "Not Linked",
                pinState=live.pin_state,
                openNow=live.open_now,
                offlineSince=live.offline_since,
                closedReason=live.closed_reason,
                alerts=[
                    MapEnterpriseAlert(
                        type=alert.alert_type,  # type: ignore[arg-type]
                        camera=alert.camera,
                        summary=alert.summary,
                        startedAt=alert.active_at or alert.started_at,
                    )
                    for alert in place_alerts
                ],
            )
        )
    return enterprises


@router.get("/alerts", response_model=list[OperationalAlertSummary])
async def list_alerts(
    account: AlertReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[OperationalAlertSummary]:
    """Every alert happening now: busier than usual, and cameras not counting."""
    return await list_live_alerts(db, account)


def monitoring_status_from_telemetry(
    telemetry: TelemetrySnapshotSummary | None,
) -> str:
    if telemetry is None:
        return "Offline"
    if telemetry.gatewayStatus == "Offline":
        return "Offline"
    if telemetry.error or telemetry.status == "error":
        return "Fault"
    if telemetry.gatewayStatus == "Sync Delayed":
        return "Updates Delayed"
    return {
        "running": "Fully Monitoring",
        "partial": "Partially Monitoring",
        "stopped": "Stopped",
        "error": "Fault",
        "not_configured": "Not Configured",
    }[telemetry.monitoring.status]


def occupancy_status_from_telemetry(
    telemetry: TelemetrySnapshotSummary | None, building_capacity: int
) -> str:
    if (
        telemetry is None
        or telemetry.gatewayStatus != "Connected"
        or telemetry.error
        or telemetry.status == "error"
        or telemetry.currentOccupancy is None
        or building_capacity <= 0
    ):
        return "No Data"
    if telemetry.currentOccupancy >= building_capacity:
        return "High Occupancy"
    if telemetry.currentOccupancy * 100 >= building_capacity * 80:
        return "Warning"
    return "Normal"
