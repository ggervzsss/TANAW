import json
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.json_values import parse_json_object
from app.features.accounts.enterprise import require_enterprise_profile
from app.features.accounts.models import Account, AccountRole
from app.features.accounts.options import format_enterprise_category
from app.features.monitoring.models import EnterpriseTelemetrySnapshot
from app.features.monitoring.schemas import (
    DesktopCameraMonitoringSummary,
    DesktopTelemetryIngest,
    TelemetrySnapshotSummary,
)

STALE_GATEWAY_SECONDS = 120
OFFLINE_GATEWAY_SECONDS = 900


async def ingest_telemetry(
    db: AsyncSession,
    account: Account,
    payload: DesktopTelemetryIngest,
    *,
    update_account_gateway: bool = True,
) -> TelemetrySnapshotSummary:
    captured_at = payload.capturedAt or payload.metrics.lastEventAt or datetime.now(UTC)
    if captured_at.tzinfo is None:
        captured_at = captured_at.replace(tzinfo=UTC)

    profile = require_enterprise_profile(account)
    snapshot = EnterpriseTelemetrySnapshot(
        enterprise_profile_id=profile.account_id,
        enterprise_name=profile.enterprise_name,
        camera_id=str(payload.session.cameraId) if payload.session.cameraId is not None else None,
        camera_name=payload.session.cameraName,
        captured_at=captured_at,
        entries=payload.metrics.entries,
        exits=payload.metrics.exits,
        current_occupancy=payload.metrics.currentOccupancy,
        peak_occupancy=payload.metrics.peakOccupancy,
        unique_count=payload.metrics.uniqueCount,
        confirmed_unique_count=payload.metrics.confirmedUniqueCount,
        degraded_unique_count=payload.metrics.degradedUniqueCount,
        total_events=payload.metrics.totalEvents,
        unsubmitted_events=payload.metrics.unsubmittedEvents,
        unsynced_events=payload.metrics.unsyncedEvents,
        running=payload.session.running,
        status=payload.session.status,
        error=payload.session.error,
        analytics_fps=payload.health.analyticsFps,
        payload_json=json.dumps(payload.model_dump(mode="json"), sort_keys=True),
    )
    db.add(snapshot)
    if update_account_gateway:
        profile.gateway_status = (
            "Offline" if snapshot.error or snapshot.status == "error" else "Connected"
        )
        if payload.deviceId:
            profile.gateway_id = payload.deviceId
    await db.flush()
    await db.refresh(snapshot)
    return to_telemetry_summary(snapshot, account)


async def list_latest_telemetry(
    db: AsyncSession, account: Account | None, limit: int = 500
) -> list[TelemetrySnapshotSummary]:
    enterprise_account_id = (
        account.id if account is not None and account.role == AccountRole.ENTERPRISE else None
    )
    ranked_statement = select(
        EnterpriseTelemetrySnapshot.id.label("snapshot_id"),
        func.row_number()
        .over(
            partition_by=EnterpriseTelemetrySnapshot.enterprise_profile_id,
            order_by=(
                EnterpriseTelemetrySnapshot.received_at.desc(),
                EnterpriseTelemetrySnapshot.id.desc(),
            ),
        )
        .label("snapshot_rank"),
    )
    if enterprise_account_id is not None:
        ranked_statement = ranked_statement.where(
            EnterpriseTelemetrySnapshot.enterprise_profile_id == enterprise_account_id
        )
    latest_ranked_snapshot = ranked_statement.subquery()
    statement = (
        select(EnterpriseTelemetrySnapshot)
        .join(
            latest_ranked_snapshot,
            EnterpriseTelemetrySnapshot.id == latest_ranked_snapshot.c.snapshot_id,
        )
        .where(latest_ranked_snapshot.c.snapshot_rank == 1)
        .order_by(
            EnterpriseTelemetrySnapshot.received_at.desc(),
            EnterpriseTelemetrySnapshot.id.desc(),
        )
        .limit(limit)
    )
    snapshots = (await db.scalars(statement)).all()
    accounts = (
        {account.id: account}
        if account is not None and enterprise_account_id is not None
        else await enterprise_accounts_by_id(db)
    )

    return [
        to_telemetry_summary(snapshot, accounts.get(snapshot.enterprise_profile_id))
        for snapshot in snapshots
    ]


async def enterprise_accounts_by_id(db: AsyncSession) -> dict[str, Account]:
    accounts = (
        await db.scalars(select(Account).where(Account.role == AccountRole.ENTERPRISE))
    ).all()
    return {account.id: account for account in accounts}


def to_telemetry_summary(
    snapshot: EnterpriseTelemetrySnapshot, account: Account | None = None
) -> TelemetrySnapshotSummary:
    profile = require_enterprise_profile(account) if account else snapshot.enterprise_profile
    return TelemetrySnapshotSummary(
        id=snapshot.id,
        enterpriseId=profile.enterprise_id,
        enterpriseName=profile.enterprise_name if account else snapshot.enterprise_name,
        category=format_enterprise_category(profile.category),
        barangay=profile.barangay,
        cameraId=snapshot.camera_id,
        cameraName=snapshot.camera_name,
        capturedAt=snapshot.captured_at,
        receivedAt=snapshot.received_at,
        entries=snapshot.entries,
        exits=snapshot.exits,
        currentOccupancy=snapshot.current_occupancy,
        peakOccupancy=snapshot.peak_occupancy,
        uniqueCount=snapshot.unique_count,
        confirmedUniqueCount=snapshot.confirmed_unique_count,
        degradedUniqueCount=snapshot.degraded_unique_count,
        totalEvents=snapshot.total_events,
        unsubmittedEvents=snapshot.unsubmitted_events,
        unsyncedEvents=snapshot.unsynced_events,
        running=snapshot.running,
        status=snapshot.status,
        error=snapshot.error,
        analyticsFps=snapshot.analytics_fps,
        gatewayStatus=gateway_status_for_snapshot(snapshot),
        monitoring=telemetry_monitoring_from_payload(snapshot.payload_json),
    )


def telemetry_monitoring_from_payload(
    payload_json: str | None,
) -> DesktopCameraMonitoringSummary:
    payload = parse_json_object(payload_json)
    monitoring = payload.get("monitoring") if payload else None
    if not isinstance(monitoring, dict):
        return DesktopCameraMonitoringSummary()
    return DesktopCameraMonitoringSummary.model_validate(monitoring)


def gateway_status_for_snapshot(snapshot: EnterpriseTelemetrySnapshot) -> str:
    now = datetime.now(UTC)
    received_at = snapshot.received_at
    if received_at is None:
        return "Offline" if snapshot.error or snapshot.status == "error" else "Connected"
    if received_at.tzinfo is None:
        received_at = received_at.replace(tzinfo=UTC)
    age = (now - received_at).total_seconds()

    if snapshot.error or snapshot.status == "error":
        return "Offline"
    if age > OFFLINE_GATEWAY_SECONDS:
        return "Offline"
    if age > STALE_GATEWAY_SECONDS:
        return "Sync Delayed"
    return "Connected"
