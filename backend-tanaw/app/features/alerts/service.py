from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import AccountRole
from app.features.alerts.models import OperationalAlert
from app.features.alerts.schemas import OperationalAlertSummary
from app.features.events.operational_resources import enqueue_operational_resource_event


def to_operational_alert_summary(alert: OperationalAlert) -> OperationalAlertSummary:
    return OperationalAlertSummary(
        id=alert.alert_code,
        type=alert.alert_type,  # type: ignore[arg-type]
        severity=alert.severity,  # type: ignore[arg-type]
        enterprise=alert.enterprise,
        requester=alert.requester,
        summary=alert.summary,
        requiredAction=alert.required_action,
        resolutionMode=alert.resolution_mode,  # type: ignore[arg-type]
        status=alert.status,  # type: ignore[arg-type]
        owner=alert.owner,  # type: ignore[arg-type]
        time=alert.created_at.isoformat(),
    )


async def create_operational_alert(
    db: AsyncSession,
    *,
    alert_type: str,
    severity: str,
    requester: str,
    summary: str,
    required_action: str,
    resolution_mode: str,
    owner: str,
    enterprise: str | None = None,
    source_id: str | None = None,
) -> OperationalAlert:
    if source_id:
        existing = await db.scalar(
            select(OperationalAlert).where(
                OperationalAlert.source_id == source_id,
                OperationalAlert.alert_type == alert_type,
                OperationalAlert.status != "Resolved",
            )
        )
        if existing is not None:
            existing.severity = severity
            existing.summary = summary
            existing.required_action = required_action
            await db.flush([existing])
            await enqueue_operational_resource_event(
                db,
                event_type="operational_alert.updated.v2",
                aggregate_type="operational_alert",
                aggregate_id=existing.id,
                aggregate_version=2,
                payload={"operationalAlertId": existing.id},
                actor_account_id=None,
            )
            await db.refresh(existing)
            return existing

    alert_sequence = await db.scalar(text("SELECT nextval('operational_alert_code_seq')"))
    if not isinstance(alert_sequence, int):
        raise RuntimeError("The operational alert code sequence returned an invalid value.")
    alert = OperationalAlert(
        alert_code=f"ALT-{alert_sequence:06d}",
        alert_type=alert_type,
        severity=severity,
        enterprise=enterprise,
        requester=requester,
        summary=summary,
        required_action=required_action,
        resolution_mode=resolution_mode,
        owner=owner,
        source_id=source_id,
    )
    db.add(alert)
    await db.flush([alert])
    await enqueue_operational_resource_event(
        db,
        event_type="operational_alert.created.v2",
        aggregate_type="operational_alert",
        aggregate_id=alert.id,
        aggregate_version=1,
        payload={"operationalAlertId": alert.id},
        actor_account_id=None,
    )
    await db.refresh(alert)
    return alert


async def list_operational_alerts(db: AsyncSession) -> list[OperationalAlertSummary]:
    result = await db.scalars(select(OperationalAlert).order_by(OperationalAlert.created_at.desc()))
    return [to_operational_alert_summary(alert) for alert in result]


def can_view_operational_event(role: str, event_type: str) -> bool:
    if event_type == "resource.invalidated":
        return role in {item.value for item in AccountRole}
    return False
