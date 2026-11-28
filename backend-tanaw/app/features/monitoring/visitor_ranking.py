"""Visitors per enterprise for a date range, for the Admin Dashboard's Most Visited ranking.

Each day of the range takes one of two sources:

- Monthly reports: a past calendar month that lies wholly inside the range and has at least one
  submitted report counts each report's unique visitor count.
- Camera counts: any other day in the camera history (the last ``CAMERA_HISTORY_DAYS`` days, today
  included) counts each enterprise's latest unique visitor estimate of that day.

Days that fit neither are counted as uncovered, so the page can say they were left out.
"""

from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.date_time import PHILIPPINE_TIME_ZONE, ensure_aware
from app.features.accounts.attractions import attraction_category
from app.features.accounts.models import EnterpriseProfile
from app.features.monitoring.schemas import VisitorRankingEnterprise, VisitorRankingSummary
from app.features.monitoring.visitor_insights import (
    CAMERA_HISTORY_DAYS,
    HourlyVisitorObservation,
    load_hourly_visitor_observations,
)
from app.features.reporting.models import REPORT_RETURNED_STATUS, EnterpriseReportSubmission
from app.features.reporting.periods import reporting_period_key

MAX_RANKING_DAYS = 3700
MONTH_NAMES = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


class InvalidRankingRangeError(ValueError):
    pass


@dataclass(frozen=True)
class RankingPlan:
    report_months: tuple[str, ...]
    camera_days: tuple[date, ...]
    includes_today: bool
    uncovered_days: int


@dataclass(frozen=True)
class EnterpriseIdentity:
    enterprise_id: str
    name: str
    barangay: str
    category: str


@dataclass(frozen=True)
class ReportVisitors:
    enterprise: EnterpriseIdentity
    period_key: str
    unique_count: int


def month_key(day: date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def _last_day_of_month(day: date) -> date:
    following = date(day.year + (day.month == 12), day.month % 12 + 1, 1)
    return following - timedelta(days=1)


def months_in_range(start: date, end: date) -> list[date]:
    """The first day of every calendar month that the range touches."""
    months: list[date] = []
    current = date(start.year, start.month, 1)
    while current <= end:
        months.append(current)
        current = _last_day_of_month(current) + timedelta(days=1)
    return months


def validate_ranking_range(start: date, end: date) -> None:
    if start > end:
        raise InvalidRankingRangeError("The start date must be on or before the end date.")
    if (end - start).days + 1 > MAX_RANKING_DAYS:
        raise InvalidRankingRangeError("Choose a range of at most ten years.")


def plan_visitor_ranking(
    start: date, end: date, today: date, reported_months: Iterable[str]
) -> RankingPlan:
    """Decide which source covers each day of the range, up to today."""
    reported = set(reported_months)
    current_month = month_key(today)
    earliest_camera_day = today - timedelta(days=CAMERA_HISTORY_DAYS - 1)
    last_day = min(end, today)
    report_months: list[str] = []
    camera_days: list[date] = []
    includes_today = False
    uncovered = 0
    day = start
    while day <= last_day:
        key = month_key(day)
        whole_month = start <= day.replace(day=1) and end >= _last_day_of_month(day)
        if key < current_month and whole_month and key in reported:
            if key not in report_months:
                report_months.append(key)
        elif day == today:
            includes_today = True
        elif day >= earliest_camera_day:
            camera_days.append(day)
        else:
            uncovered += 1
        day += timedelta(days=1)
    return RankingPlan(tuple(report_months), tuple(camera_days), includes_today, uncovered)


def daily_unique_by_enterprise(
    observations: Sequence[HourlyVisitorObservation],
) -> dict[tuple[str, date], int]:
    """Each enterprise's latest unique visitor estimate of each day, as visitor insights reports it."""
    latest: dict[tuple[str, date], HourlyVisitorObservation] = {}
    for observation in observations:
        if observation.estimated_unique_count is None:
            continue
        key = (observation.enterprise_id, observation.start_at.date())
        current = latest.get(key)
        if current is None or observation.start_at > current.start_at:
            latest[key] = observation
    return {key: item.estimated_unique_count or 0 for key, item in latest.items()}


def counted_camera_days(plan: RankingPlan, today: date) -> set[date]:
    return set(plan.camera_days) | ({today} if plan.includes_today else set())


def rank_enterprise_visitors(
    plan: RankingPlan,
    today: date,
    reports: Sequence[ReportVisitors],
    daily_unique: dict[tuple[str, date], int],
    enterprises: dict[str, EnterpriseIdentity],
) -> list[VisitorRankingEnterprise]:
    """Total visitors per enterprise under the plan, busiest first; enterprises with none are left out."""
    totals: dict[str, int] = defaultdict(int)
    identities = dict(enterprises)
    report_months = set(plan.report_months)
    for report in reports:
        if report.period_key in report_months:
            totals[report.enterprise.enterprise_id] += report.unique_count
            identities.setdefault(report.enterprise.enterprise_id, report.enterprise)

    camera_days = counted_camera_days(plan, today)
    for (enterprise_id, day), unique in daily_unique.items():
        if day in camera_days:
            totals[enterprise_id] += unique

    ranked = [
        VisitorRankingEnterprise(
            enterpriseId=enterprise_id,
            enterpriseName=identities[enterprise_id].name,
            barangay=identities[enterprise_id].barangay,
            category=identities[enterprise_id].category,
            visitors=visitors,
        )
        for enterprise_id, visitors in totals.items()
        if visitors > 0 and enterprise_id in identities
    ]
    ranked.sort(key=lambda item: (-item.visitors, item.enterpriseName))
    return ranked


def _identity(profile: EnterpriseProfile) -> EnterpriseIdentity:
    return EnterpriseIdentity(
        enterprise_id=profile.enterprise_id,
        name=profile.enterprise_name,
        barangay=profile.barangay or "Unassigned",
        category=attraction_category(profile.attraction_code, profile.attraction_description),
    )


async def _load_reports(db: AsyncSession, start: date, end: date) -> list[ReportVisitors]:
    periods = [
        f"{MONTH_NAMES[month.month - 1]} {month.year}" for month in months_in_range(start, end)
    ]
    submissions = (
        await db.scalars(
            # A returned report waits for its corrected version; every other period has at most one
            # live version, which is the one to count.
            select(EnterpriseReportSubmission).where(
                EnterpriseReportSubmission.period.in_(periods),
                EnterpriseReportSubmission.review_status != REPORT_RETURNED_STATUS,
            )
        )
    ).all()
    reports: list[ReportVisitors] = []
    for submission in submissions:
        period_key = reporting_period_key(submission.period)
        if period_key is None:
            continue
        reports.append(
            ReportVisitors(
                enterprise=_identity(submission.enterprise_profile),
                period_key=period_key,
                unique_count=submission.unique_count,
            )
        )
    return reports


async def get_visitor_ranking(
    db: AsyncSession, start: date, end: date, *, now: datetime | None = None
) -> VisitorRankingSummary:
    validate_ranking_range(start, end)
    current_time = ensure_aware(now or datetime.now(UTC))
    today = current_time.astimezone(PHILIPPINE_TIME_ZONE).date()
    reports = await _load_reports(db, start, end)
    plan = plan_visitor_ranking(start, end, today, {report.period_key for report in reports})

    daily_unique: dict[tuple[str, date], int] = {}
    enterprises: dict[str, EnterpriseIdentity] = {}
    if plan.camera_days or plan.includes_today:
        observations = await load_hourly_visitor_observations(db, current_time)
        counted_days = counted_camera_days(plan, today)
        daily_unique = {
            key: unique
            for key, unique in daily_unique_by_enterprise(observations).items()
            if key[1] in counted_days
        }
        enterprise_ids = {enterprise_id for enterprise_id, _ in daily_unique}
        if enterprise_ids:
            profiles = (
                await db.scalars(
                    select(EnterpriseProfile).where(
                        EnterpriseProfile.enterprise_id.in_(enterprise_ids)
                    )
                )
            ).all()
            enterprises = {profile.enterprise_id: _identity(profile) for profile in profiles}

    return VisitorRankingSummary(
        start=start,
        end=end,
        reportMonths=list(plan.report_months),
        cameraDays=len(plan.camera_days) + int(plan.includes_today),
        includesToday=plan.includes_today,
        uncoveredDays=plan.uncovered_days,
        enterprises=rank_enterprise_visitors(plan, today, reports, daily_unique, enterprises),
    )
