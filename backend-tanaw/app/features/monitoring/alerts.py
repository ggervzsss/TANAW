"""Live alerts: a place busier than usual, or a camera that is not counting.

An alert is live while its problem lasts and ends by itself when the problem clears; nobody
marks it handled. A camera problem first waits as Pending, so a camera that drops for a few
seconds raises nothing; it becomes Active once it has lasted the camera wait time IT chose.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from math import ceil
from statistics import fmean
from typing import Literal, cast

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.date_time import PHILIPPINE_TIME_ZONE, ensure_aware
from app.features.accounts.enterprise import enterprise_name
from app.features.accounts.models import Account, AccountRole, EnterpriseProfile
from app.features.activity_logs.service import record_activity_log
from app.features.monitoring.models import (
    OPERATIONAL_ALERT_CODE_SEQUENCE,
    EnterpriseTelemetrySnapshot,
    OperationalAlert,
)
from app.features.monitoring.schemas import (
    DesktopTelemetryIngest,
    OperationalAlertSummary,
)

ALERT_BUSY = "Busier Than Usual"
ALERT_CAMERA = "Camera Not Counting"
CAMERA_WAIT_MINUTES_SETTING_KEY = "monitoring.cameraWaitMinutes"
CAMERA_WAIT_MINUTES = 15
ALLOWED_CAMERA_WAIT_MINUTES = frozenset({5, 15, 30, 60})
SERVICE_CAMERA_KEY = "service"
VISITOR_ACTIVITY_BASELINE_DAYS = 35
VISITOR_ACTIVITY_MIN_BASELINE_DAYS = 3
VISITOR_ACTIVITY_TRIGGER_MULTIPLIER = 1.5
VISITOR_ACTIVITY_RECOVERY_MULTIPLIER = 1.2
VISITOR_ACTIVITY_MIN_INCREASE = 10

AlertChange = Literal["started", "ended"]
AlertEvent = tuple[AlertChange, OperationalAlert]


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


@dataclass(frozen=True)
class CameraProblem:
    key: str
    name: str | None
    error: str


def resolve_camera_wait_minutes(values: Mapping[str, object] | None) -> int:
    value = (values or {}).get(CAMERA_WAIT_MINUTES_SETTING_KEY)
    if isinstance(value, int) and not isinstance(value, bool):
        return value if value in ALLOWED_CAMERA_WAIT_MINUTES else CAMERA_WAIT_MINUTES
    return CAMERA_WAIT_MINUTES


def to_alert_summary(
    alert: OperationalAlert, *, enterprise_id: str | None, include_detail: bool
) -> OperationalAlertSummary:
    return OperationalAlertSummary(
        id=alert.alert_code,
        type=cast(Literal["Busier Than Usual", "Camera Not Counting"], alert.alert_type),
        severity=cast(Literal["Warning", "Critical"], alert.severity),
        status=cast(Literal["Pending", "Active", "Ended"], alert.status),
        enterpriseId=enterprise_id,
        enterpriseName=alert.enterprise,
        camera=alert.camera,
        summary=alert.summary,
        detail=alert.detail if include_detail else None,
        startedAt=alert.active_at or alert.started_at,
        endedAt=alert.ended_at,
    )


async def list_live_alerts(db: AsyncSession, account: Account) -> list[OperationalAlertSummary]:
    """Every alert that is happening now, newest first. Admin and IT see the same alerts."""
    rows = await db.execute(
        select(OperationalAlert, EnterpriseProfile.enterprise_id)
        .outerjoin(
            EnterpriseProfile,
            EnterpriseProfile.account_id == OperationalAlert.enterprise_profile_id,
        )
        .where(OperationalAlert.status == "Active")
        .order_by(OperationalAlert.active_at.desc(), OperationalAlert.id.desc())
    )
    include_detail = account.role == AccountRole.IT
    return [
        to_alert_summary(alert, enterprise_id=enterprise_id, include_detail=include_detail)
        for alert, enterprise_id in rows
    ]


async def live_alerts_by_enterprise(db: AsyncSession) -> dict[str, list[OperationalAlert]]:
    alerts = await db.scalars(select(OperationalAlert).where(OperationalAlert.status == "Active"))
    grouped: dict[str, list[OperationalAlert]] = {}
    for alert in alerts:
        if alert.enterprise_profile_id:
            grouped.setdefault(alert.enterprise_profile_id, []).append(alert)
    return grouped


async def _next_alert_code(db: AsyncSession) -> str:
    number = await db.scalar(select(OPERATIONAL_ALERT_CODE_SEQUENCE.next_value()))
    if number is None:
        raise RuntimeError("Operational alert code sequence did not return a value.")
    return f"ALT-{number:06d}"


async def _open_alert(
    db: AsyncSession, *, alert_type: str, source_id: str
) -> OperationalAlert | None:
    return cast(
        OperationalAlert | None,
        await db.scalar(
            select(OperationalAlert).where(
                OperationalAlert.source_id == source_id,
                OperationalAlert.alert_type == alert_type,
                OperationalAlert.status.in_({"Pending", "Active"}),
            )
        ),
    )


def camera_problems(payload: DesktopTelemetryIngest) -> list[CameraProblem]:
    """The cameras that are not counting, or the camera service itself when it failed."""
    problems = [
        CameraProblem(
            key=str(camera.cameraId),
            name=camera.cameraName,
            error=camera.error or "The camera stopped sending video.",
        )
        for camera in payload.monitoring.cameras
        if camera.status == "error" or camera.error
    ]
    if payload.session.error and not problems:
        camera_key = payload.session.cameraId
        problems.append(
            CameraProblem(
                key=str(camera_key) if camera_key is not None else SERVICE_CAMERA_KEY,
                name=payload.session.cameraName,
                error=payload.session.error,
            )
        )
    return problems


def _camera_source(account: Account, key: str) -> str:
    return f"camera:{account.id}:{key}"


def _camera_summary(place: str, camera: str | None, counting: int, configured: int) -> str:
    who = f"The {camera} camera" if camera else "The camera service"
    sentence = f"{who} at {place} is not counting."
    if configured > 1:
        sentence += f" {counting} of {configured} cameras are counting."
    return sentence


def _camera_detail(problem: CameraProblem, payload: DesktopTelemetryIngest) -> str:
    parts = [f"Camera: {problem.name or 'camera service'}", f"Error: {problem.error}"]
    if payload.metrics.lastEventAt is not None:
        last = ensure_aware(payload.metrics.lastEventAt).astimezone(PHILIPPINE_TIME_ZONE)
        parts.append(f"Last count: {last.strftime('%I:%M %p').lstrip('0')}")
    if payload.health.processingProfile:
        parts.append(f"Processing: {payload.health.processingProfile}")
    return " · ".join(parts)


def _activate(alert: OperationalAlert, now: datetime) -> None:
    alert.status = "Active"
    alert.active_at = now


def _wait_has_passed(alert: OperationalAlert, now: datetime, wait_minutes: int) -> bool:
    return ensure_aware(alert.started_at) + timedelta(minutes=wait_minutes) <= now


async def evaluate_camera_alerts(
    db: AsyncSession,
    account: Account,
    payload: DesktopTelemetryIngest,
    *,
    now: datetime,
    wait_minutes: int,
) -> list[AlertEvent]:
    """Start, keep or end camera alerts from one telemetry check-in."""
    events: list[AlertEvent] = []
    place = enterprise_name(account)
    monitoring = payload.monitoring
    problems = camera_problems(payload)
    for problem in problems:
        source_id = _camera_source(account, problem.key)
        summary = _camera_summary(
            place, problem.name, monitoring.healthyCameraCount, monitoring.configuredCameraCount
        )
        alert = await _open_alert(db, alert_type=ALERT_CAMERA, source_id=source_id)
        if alert is None:
            alert = OperationalAlert(
                alert_code=await _next_alert_code(db),
                alert_type=ALERT_CAMERA,
                severity="Critical",
                enterprise_profile_id=account.id,
                enterprise=place,
                camera=problem.name,
                summary=summary,
                detail=_camera_detail(problem, payload),
                status="Pending",
                source_id=source_id,
                started_at=now,
            )
            db.add(alert)
        else:
            alert.summary = summary
            alert.detail = _camera_detail(problem, payload)
        if alert.status == "Pending" and _wait_has_passed(alert, now, wait_minutes):
            _activate(alert, now)
            events.append(("started", alert))
    open_keys = {_camera_source(account, problem.key) for problem in problems}
    events.extend(await _clear_camera_alerts(db, account.id, keep=open_keys, now=now))
    await db.flush()
    return events


async def _clear_camera_alerts(
    db: AsyncSession, enterprise_account_id: str, *, keep: set[str], now: datetime
) -> list[AlertEvent]:
    alerts = await db.scalars(
        select(OperationalAlert).where(
            OperationalAlert.enterprise_profile_id == enterprise_account_id,
            OperationalAlert.alert_type == ALERT_CAMERA,
            OperationalAlert.status.in_({"Pending", "Active"}),
        )
    )
    events: list[AlertEvent] = []
    for alert in list(alerts):
        if alert.source_id in keep:
            continue
        if alert.status == "Pending":
            # It never lasted long enough to become an alert.
            await db.delete(alert)
            continue
        alert.status = "Ended"
        alert.ended_at = now
        events.append(("ended", alert))
    return events


async def end_camera_alerts_for(
    db: AsyncSession, enterprise_account_id: str, *, now: datetime
) -> list[AlertEvent]:
    """The desktop app went offline, so TANAW no longer knows how its cameras are doing."""
    events = await _clear_camera_alerts(db, enterprise_account_id, keep=set(), now=now)
    await db.flush()
    return events


async def promote_pending_camera_alerts(
    db: AsyncSession, *, now: datetime, wait_minutes: int
) -> list[OperationalAlert]:
    cutoff = now - timedelta(minutes=wait_minutes)
    alerts = list(
        await db.scalars(
            select(OperationalAlert).where(
                OperationalAlert.alert_type == ALERT_CAMERA,
                OperationalAlert.status == "Pending",
                OperationalAlert.started_at <= cutoff,
            )
        )
    )
    for alert in alerts:
        _activate(alert, now)
    await db.flush()
    return alerts


async def remove_alerts_for_enterprise(db: AsyncSession, enterprise_account_id: str) -> None:
    await db.execute(
        delete(OperationalAlert).where(
            OperationalAlert.enterprise_profile_id == enterprise_account_id
        )
    )


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
            EnterpriseTelemetrySnapshot.current_occupancy.is_not(None),
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


async def evaluate_busy_alert(
    db: AsyncSession,
    account: Account,
    payload: DesktopTelemetryIngest,
    *,
    now: datetime,
    baseline_occupancies: Sequence[int | float] | None = None,
) -> list[AlertEvent]:
    occupancy = payload.metrics.currentOccupancy
    if occupancy is None:
        return []
    source_id = f"visitor-activity:{account.id}"
    existing = await _open_alert(db, alert_type=ALERT_BUSY, source_id=source_id)
    reference_time = payload.capturedAt or payload.metrics.lastEventAt or now
    baseline = (
        list(baseline_occupancies)
        if baseline_occupancies is not None
        else await load_matching_visitor_baseline(db, account.id, reference_time)
    )
    condition = visitor_activity_condition(occupancy, baseline)

    if condition is not None and condition.breached:
        if existing is not None:
            return []
        place = enterprise_name(account)
        period = format_visitor_period(
            ensure_aware(reference_time).astimezone(PHILIPPINE_TIME_ZONE)
        )
        alert = OperationalAlert(
            alert_code=await _next_alert_code(db),
            alert_type=ALERT_BUSY,
            severity="Critical" if condition.difference_percent >= 100 else "Warning",
            enterprise_profile_id=account.id,
            enterprise=place,
            summary=(
                f"{place} has {condition.current_occupancy} visitors inside, more than its "
                f"usual {condition.typical_occupancy} around {period}."
            ),
            detail=(
                f"{condition.difference_percent}% above usual · Usual from "
                f"{condition.baseline_days} past days · Alert at {condition.threshold_count}"
            ),
            status="Active",
            source_id=source_id,
            started_at=now,
            active_at=now,
        )
        db.add(alert)
        await db.flush()
        return [("started", alert)]

    if existing is not None and (condition is None or condition.recovered):
        existing.status = "Ended"
        existing.ended_at = now
        await db.flush()
        return [("ended", existing)]
    return []


async def record_alert_events(db: AsyncSession, events: list[AlertEvent]) -> None:
    """Every alert start and end is also a Monitoring record in Activity."""
    for change, alert in events:
        place = alert.enterprise or "A place"
        if alert.alert_type == ALERT_BUSY:
            action = "Busier Than Usual" if change == "started" else "Back to Usual"
            summary = (
                alert.summary
                if change == "started"
                else f"{place} is back to its usual number of visitors."
            )
        else:
            action = "Camera Stopped Counting" if change == "started" else "Camera Counting Again"
            camera = f"The {alert.camera} camera" if alert.camera else "The camera service"
            summary = (
                alert.summary if change == "started" else f"{camera} at {place} is counting again."
            )
        await record_activity_log(
            db,
            group="Monitoring",
            severity="Warning" if change == "started" else "Success",
            actor="TANAW",
            actor_role="System",
            action=action,
            target=place,
            summary=summary,
            source_id=alert.id,
            it_detail=alert.detail,
            metadata={"alertCode": alert.alert_code, "alertType": alert.alert_type},
        )


def format_visitor_period(value: datetime) -> str:
    return value.strftime("%A at %I %p").replace(" at 0", " at ")


def utc_now() -> datetime:
    return datetime.now(UTC)
