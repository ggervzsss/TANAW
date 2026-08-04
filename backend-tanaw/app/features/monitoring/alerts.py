from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from math import ceil
from statistics import fmean
from typing import cast

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.date_time import PHILIPPINE_TIME_ZONE, ensure_aware
from app.features.accounts.enterprise import enterprise_name
from app.features.accounts.models import Account, AccountRole
from app.features.monitoring.models import EnterpriseTelemetrySnapshot, OperationalAlert
from app.features.monitoring.schemas import (
    DesktopTelemetryIngest,
    OperationalAlertSummary,
    OperationalAlertUrgency,
)

VISITOR_ACTIVITY_BASELINE_DAYS = 35
VISITOR_ACTIVITY_MIN_BASELINE_DAYS = 3
VISITOR_ACTIVITY_TRIGGER_MULTIPLIER = 1.5
VISITOR_ACTIVITY_RECOVERY_MULTIPLIER = 1.2
VISITOR_ACTIVITY_MIN_INCREASE = 10


@dataclass(frozen=True)
class VisitorActivityCondition:
    typical_occupancy: int
    baseline_days: int
    threshold_count: int
    recovery_count: int
    current_occupancy: int

    @property
    def breached(self) -> bool:
        return self.current_occupancy >= self.threshold_count

    @property
    def recovered(self) -> bool:
        return self.current_occupancy <= self.recovery_count

    @property
    def difference_percent(self) -> int:
        if self.typical_occupancy <= 0:
            return 100 if self.current_occupancy > 0 else 0
        return round(
            (self.current_occupancy - self.typical_occupancy) / self.typical_occupancy * 100
        )


def to_operational_alert_summary(alert: OperationalAlert) -> OperationalAlertSummary:
    return OperationalAlertSummary(
        id=alert.alert_code,
        type=alert.alert_type,  # type: ignore[arg-type]
        severity=alert.severity,  # type: ignore[arg-type]
        urgency=operational_alert_urgency(alert.severity),
        enterprise=alert.enterprise,
        requester=alert.requester,
        summary=alert.summary,
        requiredAction=alert.required_action,
        resolutionMode=alert.resolution_mode,  # type: ignore[arg-type]
        status=alert.status,  # type: ignore[arg-type]
        owner=alert.owner,  # type: ignore[arg-type]
        time=alert.created_at.isoformat(),
    )


def operational_alert_urgency(severity: str) -> OperationalAlertUrgency:
    if severity == "Critical":
        return "Urgent"
    if severity == "Warning":
        return "Important"
    return "Normal"


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
            await db.flush()
            await db.refresh(existing)
            return existing

    count = await db.scalar(select(func.count()).select_from(OperationalAlert))
    alert = OperationalAlert(
        alert_code=f"ALT-{int(count or 0) + 1:06d}",
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
    await db.flush()
    await db.refresh(alert)
    return alert


async def get_active_operational_alert(
    db: AsyncSession, *, alert_type: str, source_id: str
) -> OperationalAlert | None:
    return cast(
        OperationalAlert | None,
        await db.scalar(
            select(OperationalAlert).where(
                OperationalAlert.source_id == source_id,
                OperationalAlert.alert_type == alert_type,
                OperationalAlert.status != "Resolved",
            )
        ),
    )


async def resolve_operational_alert(
    db: AsyncSession,
    *,
    alert_type: str,
    source_id: str,
    recovery_message: str,
) -> OperationalAlert | None:
    alert = await get_active_operational_alert(db, alert_type=alert_type, source_id=source_id)
    if alert is None:
        return None
    alert.status = "Resolved"
    if recovery_message not in alert.summary:
        alert.summary = f"{alert.summary} {recovery_message}"
    await db.flush()
    await db.refresh(alert)
    return alert


async def list_operational_alerts(
    db: AsyncSession, account: Account
) -> list[OperationalAlertSummary]:
    statement = select(OperationalAlert)
    if account.role == AccountRole.ADMIN:
        statement = statement.where(OperationalAlert.owner.in_({"Admin", "System"}))
    elif account.role == AccountRole.IT:
        statement = statement.where(OperationalAlert.owner.in_({"IT", "System"}))
    result = await db.scalars(statement.order_by(OperationalAlert.created_at.desc()))
    return [to_operational_alert_summary(alert) for alert in result]


def can_manage_operational_alert(account: Account, alert: OperationalAlert) -> bool:
    if account.role == AccountRole.ADMIN:
        return alert.owner == "Admin"
    if account.role == AccountRole.IT:
        return alert.owner == "IT"
    return False


def visitor_activity_condition(
    current_occupancy: int,
    baseline_occupancies: Sequence[int | float],
) -> VisitorActivityCondition | None:
    if len(baseline_occupancies) < VISITOR_ACTIVITY_MIN_BASELINE_DAYS:
        return None
    typical_occupancy = max(0, round(fmean(baseline_occupancies)))
    threshold_count = max(
        typical_occupancy + VISITOR_ACTIVITY_MIN_INCREASE,
        ceil(typical_occupancy * VISITOR_ACTIVITY_TRIGGER_MULTIPLIER),
    )
    recovery_count = max(
        typical_occupancy,
        ceil(typical_occupancy * VISITOR_ACTIVITY_RECOVERY_MULTIPLIER),
    )
    return VisitorActivityCondition(
        typical_occupancy=typical_occupancy,
        baseline_days=len(baseline_occupancies),
        threshold_count=threshold_count,
        recovery_count=recovery_count,
        current_occupancy=max(0, current_occupancy),
    )


async def load_matching_visitor_baseline(
    db: AsyncSession,
    enterprise_profile_id: str,
    reference_time: datetime,
) -> list[float]:
    reference = ensure_aware(reference_time)
    local_reference = reference.astimezone(PHILIPPINE_TIME_ZONE)
    local_timestamp = func.timezone(
        str(PHILIPPINE_TIME_ZONE), EnterpriseTelemetrySnapshot.captured_at
    )
    local_day = func.date_trunc("day", local_timestamp)
    weekday = (local_reference.weekday() + 1) % 7
    statement = (
        select(func.avg(EnterpriseTelemetrySnapshot.current_occupancy))
        .where(
            EnterpriseTelemetrySnapshot.enterprise_profile_id == enterprise_profile_id,
            EnterpriseTelemetrySnapshot.captured_at
            >= reference - timedelta(days=VISITOR_ACTIVITY_BASELINE_DAYS),
            EnterpriseTelemetrySnapshot.captured_at < reference - timedelta(days=1),
            func.extract("dow", local_timestamp) == weekday,
            func.extract("hour", local_timestamp) == local_reference.hour,
        )
        .group_by(local_day)
        .order_by(local_day.desc())
    )
    return [float(value) for value in (await db.scalars(statement)).all()]


async def evaluate_telemetry_alerts(
    db: AsyncSession,
    account: Account,
    payload: DesktopTelemetryIngest,
    *,
    baseline_occupancies: Sequence[int | float] | None = None,
) -> list[tuple[str, OperationalAlertSummary]]:
    source_id = f"visitor-activity:{account.id}"
    existing = await db.scalar(
        select(OperationalAlert).where(
            OperationalAlert.source_id == source_id,
            OperationalAlert.alert_type == "Foot Traffic Alert",
            OperationalAlert.status != "Resolved",
        )
    )
    reference_time = payload.capturedAt or payload.metrics.lastEventAt or datetime.now(UTC)
    baseline = (
        list(baseline_occupancies)
        if baseline_occupancies is not None
        else await load_matching_visitor_baseline(db, account.id, reference_time)
    )
    condition = visitor_activity_condition(payload.metrics.currentOccupancy, baseline)

    if condition is not None and condition.breached:
        if existing is not None:
            return []

        enterprise = enterprise_name(account)
        local_reference = ensure_aware(reference_time).astimezone(PHILIPPINE_TIME_ZONE)
        period_label = format_visitor_period(local_reference)
        alert = await create_operational_alert(
            db,
            alert_type="Foot Traffic Alert",
            severity="Critical" if condition.difference_percent >= 100 else "Warning",
            requester=enterprise,
            enterprise=enterprise,
            summary=(
                f"{enterprise} currently has {condition.current_occupancy} visitors, compared "
                f"with its usual {condition.typical_occupancy} around {period_label}."
            ),
            required_action=(
                "Review the live map and coordinate with the establishment, traffic team, or "
                "public-safety personnel if support is needed."
            ),
            resolution_mode="Admin Monitoring",
            owner="Admin",
            source_id=source_id,
        )
        return [("alert.created", to_operational_alert_summary(alert))]

    should_resolve = existing is not None and (condition is None or condition.recovered)
    if should_resolve and existing is not None:
        existing.status = "Resolved"
        existing.summary = (
            f"{existing.summary} The latest visitor level has returned to its usual range."
        )
        await db.flush()
        await db.refresh(existing)
        return [("alert.resolved", to_operational_alert_summary(existing))]

    return []


def format_visitor_period(value: datetime) -> str:
    return value.strftime("%A at %I %p").replace(" at 0", " at ")
