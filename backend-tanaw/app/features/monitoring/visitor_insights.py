from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from statistics import fmean

from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import aggregate_order_by, array_agg
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.date_time import PHILIPPINE_TIME_ZONE, ensure_aware
from app.features.accounts.models import EnterpriseProfile
from app.features.monitoring.alerts import (
    VISITOR_ACTIVITY_BASELINE_DAYS,
    visitor_activity_condition,
)
from app.features.monitoring.models import EnterpriseTelemetrySnapshot
from app.features.monitoring.schemas import (
    TelemetrySnapshotSummary,
    VisitorInsightEnterprise,
    VisitorInsightPoint,
    VisitorInsightRange,
    VisitorInsightsSummary,
)
from app.features.monitoring.telemetry import list_latest_telemetry


@dataclass(frozen=True)
class HourlyVisitorObservation:
    enterprise_profile_id: str
    enterprise_id: str
    enterprise_name: str
    barangay: str
    start_at: datetime
    average_visitors: float | None
    peak_visitors: int | None
    estimated_unique_count: int | None = None


async def get_visitor_insights(
    db: AsyncSession,
    range_value: VisitorInsightRange,
    *,
    enterprise_id: str | None = None,
    barangay: str | None = None,
    now: datetime | None = None,
) -> VisitorInsightsSummary:
    current_time = ensure_aware(now or datetime.now(UTC))
    local_now = current_time.astimezone(PHILIPPINE_TIME_ZONE)
    observations = await load_hourly_visitor_observations(db, current_time)
    latest = await list_latest_telemetry(db, None)

    if enterprise_id:
        observations = [item for item in observations if item.enterprise_id == enterprise_id]
        latest = [item for item in latest if item.enterpriseId == enterprise_id]
        scope_type = "enterprise"
        scope_id = enterprise_id
        scope_name = next(
            (item.enterprise_name for item in observations),
            next((item.enterpriseName for item in latest), "Selected establishment"),
        )
    elif barangay:
        normalized_barangay = barangay.strip().casefold()
        observations = [
            item for item in observations if item.barangay.casefold() == normalized_barangay
        ]
        latest = [
            item
            for item in latest
            if (item.barangay or "Unassigned").casefold() == normalized_barangay
        ]
        scope_type = "barangay"
        scope_id = barangay
        scope_name = f"Barangay {barangay}"
    else:
        scope_type = "city"
        scope_id = None
        scope_name = "San Pedro"

    baselines = visitor_baselines_by_enterprise(observations, local_now)
    enterprise_insights = [
        visitor_enterprise_insight(
            item, item.currentOccupancy, baselines.get(item.enterpriseId, [])
        )
        for item in latest
        if item.gatewayStatus == "Connected" and item.currentOccupancy is not None
    ]
    enterprise_insights.sort(key=lambda item: item.currentVisitors, reverse=True)
    current_visitors = sum(item.currentVisitors for item in enterprise_insights)
    has_complete_baseline = bool(enterprise_insights) and all(
        item.typicalVisitors is not None for item in enterprise_insights
    )
    typical_visitors = (
        sum(item.typicalVisitors or 0 for item in enterprise_insights)
        if has_complete_baseline
        else None
    )
    difference_percent = visitor_difference_percent(current_visitors, typical_visitors)
    series = visitor_insight_series(observations, range_value, local_now)
    unusually_busy = [
        item for item in enterprise_insights if item.activityLevel == "Busier Than Usual"
    ]
    busiest_period = max(
        (item for item in series if item.averageVisitors is not None),
        key=lambda item: item.averageVisitors or 0,
        default=None,
    )

    return VisitorInsightsSummary(
        range=range_value,
        scopeType=scope_type,  # type: ignore[arg-type]
        scopeId=scope_id,
        scopeName=scope_name,
        currentVisitors=current_visitors if enterprise_insights else None,
        typicalVisitors=typical_visitors,
        differencePercent=difference_percent,
        comparisonMessage=visitor_comparison_message(difference_percent),
        busiestEnterprise=enterprise_insights[0] if enterprise_insights else None,
        busiestPeriodLabel=busiest_period.label if busiest_period else None,
        series=series,
        unusuallyBusy=unusually_busy,
        lastUpdatedAt=max((item.receivedAt for item in latest), default=None),
    )


async def load_hourly_visitor_observations(
    db: AsyncSession,
    current_time: datetime,
) -> list[HourlyVisitorObservation]:
    local_timestamp = func.timezone(
        str(PHILIPPINE_TIME_ZONE), EnterpriseTelemetrySnapshot.captured_at
    )
    hour_bucket = func.date_trunc("hour", local_timestamp).label("hour_bucket")
    snapshots = EnterpriseTelemetrySnapshot
    latest_unique = array_agg(
        aggregate_order_by(
            snapshots.unique_count,
            snapshots.captured_at.desc(),
            snapshots.received_at.desc(),
            snapshots.id.desc(),
        )
    ).filter(snapshots.unique_count.is_not(None))[1]
    statement = (
        select(
            EnterpriseTelemetrySnapshot.enterprise_profile_id,
            EnterpriseProfile.enterprise_id,
            EnterpriseProfile.enterprise_name,
            EnterpriseProfile.barangay,
            hour_bucket,
            func.avg(EnterpriseTelemetrySnapshot.current_occupancy),
            func.max(EnterpriseTelemetrySnapshot.current_occupancy),
            latest_unique,
        )
        .join(
            EnterpriseProfile,
            EnterpriseProfile.account_id == EnterpriseTelemetrySnapshot.enterprise_profile_id,
        )
        .where(
            EnterpriseTelemetrySnapshot.captured_at
            >= current_time - timedelta(days=VISITOR_ACTIVITY_BASELINE_DAYS),
            or_(snapshots.current_occupancy.is_not(None), snapshots.unique_count.is_not(None)),
        )
        .group_by(
            EnterpriseTelemetrySnapshot.enterprise_profile_id,
            EnterpriseProfile.enterprise_id,
            EnterpriseProfile.enterprise_name,
            EnterpriseProfile.barangay,
            hour_bucket,
        )
        .order_by(hour_bucket.asc())
    )
    rows = (await db.execute(statement)).all()
    return [
        HourlyVisitorObservation(
            enterprise_profile_id=row[0],
            enterprise_id=row[1],
            enterprise_name=row[2],
            barangay=row[3] or "Unassigned",
            start_at=_philippine_hour(row[4]),
            average_visitors=float(row[5]) if row[5] is not None else None,
            peak_visitors=row[6],
            estimated_unique_count=row[7],
        )
        for row in rows
    ]


def visitor_baselines_by_enterprise(
    observations: Sequence[HourlyVisitorObservation],
    local_now: datetime,
) -> dict[str, list[float]]:
    values: dict[str, list[float]] = defaultdict(list)
    cutoff = local_now - timedelta(days=1)
    for observation in observations:
        if observation.average_visitors is None:
            continue
        if observation.start_at >= cutoff:
            continue
        if observation.start_at.weekday() != local_now.weekday():
            continue
        if observation.start_at.hour != local_now.hour:
            continue
        values[observation.enterprise_id].append(observation.average_visitors)
    return values


def visitor_enterprise_insight(
    telemetry: TelemetrySnapshotSummary,
    current_occupancy: int,
    baseline: Sequence[int | float],
) -> VisitorInsightEnterprise:
    condition = visitor_activity_condition(current_occupancy, baseline)
    typical_visitors = condition.typical_occupancy if condition else None
    difference_percent = visitor_difference_percent(current_occupancy, typical_visitors)
    return VisitorInsightEnterprise(
        enterpriseId=telemetry.enterpriseId,
        enterpriseName=telemetry.enterpriseName,
        barangay=telemetry.barangay or "Unassigned",
        currentVisitors=current_occupancy,
        typicalVisitors=typical_visitors,
        differencePercent=difference_percent,
        activityLevel=(
            "Busier Than Usual"
            if condition is not None and condition.breached
            else "Usual"
            if condition is not None
            else "No Recent Baseline"
        ),
    )


def visitor_insight_series(
    observations: Sequence[HourlyVisitorObservation],
    range_value: VisitorInsightRange,
    local_now: datetime,
) -> list[VisitorInsightPoint]:
    if range_value == "today":
        start_at = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
        grouped: dict[datetime, list[HourlyVisitorObservation]] = defaultdict(list)
        for observation in observations:
            if observation.start_at >= start_at:
                grouped[observation.start_at].append(observation)
        return [
            VisitorInsightPoint(
                startAt=bucket,
                label=bucket.strftime("%I %p").lstrip("0"),
                averageVisitors=rounded_sum([item.average_visitors for item in items]),
                peakVisitors=rounded_sum([item.peak_visitors for item in items]),
                estimatedUniqueCount=rounded_sum([item.estimated_unique_count for item in items]),
            )
            for bucket, items in sorted(grouped.items())
        ]

    days = 7 if range_value == "7d" else 30
    start_at = local_now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(
        days=days - 1
    )
    daily_enterprise: dict[tuple[datetime, str], list[HourlyVisitorObservation]] = defaultdict(list)
    for observation in observations:
        day = observation.start_at.replace(hour=0, minute=0, second=0, microsecond=0)
        if day >= start_at:
            daily_enterprise[(day, observation.enterprise_id)].append(observation)

    daily_totals: dict[datetime, list[tuple[float | None, int | None, int | None]]] = defaultdict(
        list
    )
    for (day, _enterprise_id), items in daily_enterprise.items():
        averages = [item.average_visitors for item in items if item.average_visitors is not None]
        peaks = [item.peak_visitors for item in items if item.peak_visitors is not None]
        latest_unique = max(
            (item for item in items if item.estimated_unique_count is not None),
            key=lambda item: item.start_at,
            default=None,
        )
        daily_totals[day].append(
            (
                fmean(averages) if averages else None,
                max(peaks, default=None),
                latest_unique.estimated_unique_count if latest_unique else None,
            )
        )

    return [
        VisitorInsightPoint(
            startAt=day,
            label=day.strftime("%a, %b %d").replace(" 0", " "),
            averageVisitors=rounded_sum([average for average, _, _ in values]),
            peakVisitors=rounded_sum([peak for _, peak, _ in values]),
            estimatedUniqueCount=rounded_sum([unique for _, _, unique in values]),
        )
        for day, values in sorted(daily_totals.items())
    ]


def rounded_sum(values: Sequence[int | float | None]) -> int | None:
    measured = [value for value in values if value is not None]
    return round(sum(measured)) if measured else None


def visitor_difference_percent(current: int, typical: int | None) -> int | None:
    if typical is None:
        return None
    if typical <= 0:
        return 100 if current > 0 else 0
    return round((current - typical) / typical * 100)


def visitor_comparison_message(difference_percent: int | None) -> str:
    if difference_percent is None:
        return "More matching days are needed before TANAW can make a reliable comparison."
    if difference_percent >= 50:
        return "Visitor activity is much higher than usual for this day and time."
    if difference_percent >= 20:
        return "Visitor activity is higher than usual for this day and time."
    if difference_percent <= -20:
        return "Visitor activity is quieter than usual for this day and time."
    return "Visitor activity is within its usual range for this day and time."


def _philippine_hour(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=PHILIPPINE_TIME_ZONE)
    return value.astimezone(PHILIPPINE_TIME_ZONE)
