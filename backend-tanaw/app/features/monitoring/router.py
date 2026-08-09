from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.enterprise import (
    enterprise_identifier,
    enterprise_name,
    require_enterprise_profile,
)
from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.accounts.options import format_enterprise_category
from app.features.activity_logs.service import record_activity_log as record_operational_log
from app.features.monitoring.alerts import (
    can_manage_operational_alert,
    create_operational_alert,
    evaluate_telemetry_alerts,
    get_active_operational_alert,
    list_operational_alerts,
    resolve_operational_alert,
    to_operational_alert_summary,
)
from app.features.monitoring.models import OperationalAlert
from app.features.monitoring.schemas import (
    DesktopTelemetryIngest,
    OperationalAlertStatusUpdate,
    OperationalAlertSummary,
    TelemetrySnapshotSummary,
    VisitorInsightRange,
    VisitorInsightsSummary,
)
from app.features.monitoring.telemetry import ingest_telemetry, list_latest_telemetry
from app.features.monitoring.visitor_insights import get_visitor_insights
from app.features.notifications.service import (
    NOTIFY_CAMERA_SESSION_ERROR_KEY,
    NOTIFY_GATEWAY_SERVICE_ERROR_KEY,
    NOTIFY_SYNC_DELAY_KEY,
    create_role_notifications,
    mark_source_notifications_read,
    system_setting_enabled,
)

router = APIRouter(prefix="/operational", tags=["monitoring"])

OperationalReadAccount = Annotated[
    Account, Depends(require_roles({"admin", "it", "staff", "enterprise"}))
]
EnterpriseAccount = Annotated[Account, Depends(require_roles({"enterprise"}))]
AdminAccount = Annotated[Account, Depends(require_roles({"admin"}))]
AlertReadAccount = Annotated[Account, Depends(require_roles({"admin", "it"}))]
AlertManageAccount = Annotated[Account, Depends(require_roles({"admin", "it"}))]


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
    for event_type, alert_summary in await evaluate_telemetry_alerts(db, account, payload):
        if event_type == "alert.created" and alert_summary.owner == "Admin":
            await create_role_notifications(
                db,
                recipient_roles=[AccountRole.ADMIN],
                title=f"{alert_summary.enterprise or alert_summary.requester} needs attention.",
                message=alert_summary.summary,
                notification_type="High Visitor Activity",
                severity=alert_summary.severity,
                actor=account,
                source_type="operational.alert",
                source_id=alert_summary.id,
            )
        if alert_summary.owner == "Admin":
            await record_operational_log(
                db,
                category="Admin Operation",
                severity=("Success" if event_type == "alert.resolved" else alert_summary.severity),
                actor="TANAW",
                actor_role="System",
                action="Alert Resolved" if event_type == "alert.resolved" else "Alert Created",
                target=alert_summary.enterprise or alert_summary.requester,
                summary=alert_summary.summary,
                source_id=alert_summary.id,
                metadata={
                    "alertType": alert_summary.type,
                    "status": alert_summary.status,
                },
            )

    sync_source_id = f"sync-failed:{account.id}"
    existing_sync_alert = await get_active_operational_alert(
        db, alert_type="Maintenance Request", source_id=sync_source_id
    )
    if payload.metrics.unsyncedEvents > 0 and await system_setting_enabled(
        db, NOTIFY_SYNC_DELAY_KEY
    ):
        sync_alert = await create_operational_alert(
            db,
            alert_type="Maintenance Request",
            severity="Warning",
            requester=account.display_name,
            enterprise=enterprise_name(account),
            summary=(
                f"{payload.metrics.unsyncedEvents} desktop record"
                f"{'' if payload.metrics.unsyncedEvents == 1 else 's'} waiting to upload."
            ),
            required_action="Review the desktop app connection and retry the upload.",
            resolution_mode="Remote Review",
            owner="IT",
            source_id=sync_source_id,
        )
        sync_alert_summary = to_operational_alert_summary(sync_alert)
        if existing_sync_alert is None:
            await notify_it_technical_issue(db, account, sync_alert_summary)
    elif payload.metrics.unsyncedEvents == 0:
        await resolve_and_publish_it_alert(
            db,
            alert_type="Maintenance Request",
            source_id=sync_source_id,
            recovery_message="Visitor data is uploading normally again.",
        )

    session_error_setting_key = (
        NOTIFY_CAMERA_SESSION_ERROR_KEY
        if payload.session.cameraId is not None or payload.session.cameraName
        else NOTIFY_GATEWAY_SERVICE_ERROR_KEY
    )
    session_source_id = f"telemetry:{account.id}:{payload.session.cameraId or 'gateway'}"
    existing_session_alert = await get_active_operational_alert(
        db, alert_type="Maintenance Request", source_id=session_source_id
    )
    if payload.session.error and await system_setting_enabled(db, session_error_setting_key):
        maintenance_alert = await create_operational_alert(
            db,
            alert_type="Maintenance Request",
            severity="Critical",
            requester=account.display_name,
            enterprise=enterprise_name(account),
            summary=payload.session.error,
            required_action="Review the camera or desktop app error and restore monitoring.",
            resolution_mode="Remote Review",
            owner="IT",
            source_id=session_source_id,
        )
        maintenance_alert_summary = to_operational_alert_summary(maintenance_alert)
        if existing_session_alert is None:
            await notify_it_technical_issue(db, account, maintenance_alert_summary)
            await record_operational_log(
                db,
                category="Enterprise Activity",
                severity="Warning",
                actor=enterprise_name(account),
                actor_role="Enterprise Account",
                action="Desktop Application Problem",
                target=enterprise_name(account),
                summary=f"{enterprise_name(account)} reported a desktop application problem: {payload.session.error}",
                source_id=maintenance_alert.id,
                metadata={
                    "enterpriseId": snapshot.enterpriseId,
                    "cameraName": snapshot.cameraName,
                    "status": snapshot.status,
                },
            )
    elif not payload.session.error:
        await resolve_and_publish_it_alert(
            db,
            alert_type="Maintenance Request",
            source_id=session_source_id,
            recovery_message="The camera or desktop application is working normally again.",
        )

    return snapshot


async def notify_it_technical_issue(
    db: AsyncSession, actor: Account, alert: OperationalAlertSummary
) -> None:
    affected_name = alert.enterprise or alert.requester
    await create_role_notifications(
        db,
        recipient_roles=[AccountRole.IT],
        title=f"{affected_name} has a technical issue.",
        message=f"{alert.summary} {alert.requiredAction}",
        notification_type="Technical Issue",
        severity=alert.severity,
        actor=actor,
        source_type="operational.alert",
        source_id=alert.id,
        replace_existing_for_source=True,
    )


async def resolve_and_publish_it_alert(
    db: AsyncSession,
    *,
    alert_type: str,
    source_id: str,
    recovery_message: str,
) -> None:
    resolved = await resolve_operational_alert(
        db,
        alert_type=alert_type,
        source_id=source_id,
        recovery_message=recovery_message,
    )
    if resolved is None:
        return
    summary = to_operational_alert_summary(resolved)
    await mark_source_notifications_read(db, source_type="operational.alert", source_id=summary.id)
    await record_operational_log(
        db,
        category="System",
        severity="Success",
        actor="TANAW",
        actor_role="System",
        action="Technical Issue Resolved",
        target=resolved.enterprise or resolved.requester,
        summary=recovery_message,
        source_id=resolved.id,
        metadata={"alertType": resolved.alert_type, "status": resolved.status},
    )


@router.get("/visitor-insights", response_model=VisitorInsightsSummary)
async def get_admin_visitor_insights(
    _: AdminAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
    range_value: Annotated[VisitorInsightRange, Query(alias="range")] = "7d",
    enterprise_id: Annotated[str | None, Query(alias="enterpriseId")] = None,
    barangay: str | None = None,
) -> VisitorInsightsSummary:
    if enterprise_id and barangay:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Choose either an establishment or a barangay insight scope.",
        )
    return await get_visitor_insights(
        db,
        range_value,
        enterprise_id=enterprise_id,
        barangay=barangay,
    )


@router.get("/map-enterprises")
async def list_map_enterprises(
    account: OperationalReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[dict]:
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

    result = await db.scalars(statement)
    enterprises = []
    for enterprise in result:
        profile = require_enterprise_profile(enterprise)
        telemetry = latest.get(enterprise_identifier(enterprise))
        enterprises.append(
            {
                "id": profile.enterprise_id,
                "name": profile.enterprise_name,
                "barangay": profile.barangay or "Unassigned",
                "category": format_enterprise_category(profile.category) or "Uncategorized",
                "fullAddress": profile.address or "Address not provided",
                "lat": profile.latitude,
                "lng": profile.longitude,
                "totalLiveOccupancy": telemetry.currentOccupancy if telemetry else 0,
                "estimatedUniqueCount": telemetry.uniqueCount if telemetry else 0,
                "monitoringStatus": monitoring_status_from_telemetry(telemetry),
                "occupancyStatus": occupancy_status_from_telemetry(
                    telemetry, profile.building_capacity
                ),
                "cameraMonitoring": telemetry.monitoring.model_dump() if telemetry else None,
                "contact": enterprise.phone or enterprise.email,
                "lastSync": telemetry.receivedAt.isoformat() if telemetry else None,
                "gatewayStatus": telemetry.gatewayStatus
                if telemetry
                else profile.gateway_status or "Not Linked",
            }
        )
    return enterprises


@router.get("/alerts", response_model=list[OperationalAlertSummary])
async def list_alerts(
    account: AlertReadAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[OperationalAlertSummary]:
    return await list_operational_alerts(db, account)


@router.patch("/alerts/{alert_code}/status", response_model=OperationalAlertSummary)
async def update_alert_status(
    alert_code: str,
    payload: OperationalAlertStatusUpdate,
    actor: AlertManageAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> OperationalAlertSummary:
    alert = await db.scalar(
        select(OperationalAlert).where(OperationalAlert.alert_code == alert_code)
    )
    if alert is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found.")
    if not can_manage_operational_alert(actor, alert):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This situation is assigned to a different account type.",
        )
    previous_status = alert.status
    alert.status = payload.status
    await db.flush()
    await db.refresh(alert)
    alert_summary = to_operational_alert_summary(alert)
    if payload.status == "Resolved":
        await mark_source_notifications_read(
            db, source_type="operational.alert", source_id=alert_summary.id
        )
    actor_role = "Admin" if actor.role == AccountRole.ADMIN else "IT Personnel"
    activity_category = "Admin Operation" if actor.role == AccountRole.ADMIN else "IT Activity"
    await record_operational_log(
        db,
        category=activity_category,
        severity="Success" if payload.status == "Resolved" else "Info",
        actor=actor.display_name,
        actor_role=actor_role,
        action=f"Alert {payload.status}",
        target=alert.enterprise or alert.requester,
        summary=f"{actor.display_name} marked {alert.alert_code} as {payload.status}.",
        source_id=alert.id,
        metadata={"previousStatus": previous_status, "newStatus": payload.status},
    )
    return alert_summary


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
        or building_capacity <= 0
    ):
        return "No Data"
    if telemetry.currentOccupancy >= building_capacity:
        return "High Occupancy"
    if telemetry.currentOccupancy * 100 >= building_capacity * 80:
        return "Warning"
    return "Normal"
