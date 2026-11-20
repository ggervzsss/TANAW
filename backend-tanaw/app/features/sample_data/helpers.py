from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import uuid5

from app.core.date_time import PHILIPPINE_TIME_ZONE
from app.features.sample_data.dataset import SAMPLE_DATASET_VERSION
from app.features.sample_data.definitions import SAMPLE_UUID_NAMESPACE


def last_reported_day(month_start: datetime, range_end: datetime) -> date:
    """The month's last day, or for the month in progress the last full day before generation."""
    month = month_start.date()
    next_month = add_months(month_start, 1).date()
    yesterday = range_end.astimezone(PHILIPPINE_TIME_ZONE).date() - timedelta(days=1)
    return max(month, min(next_month - timedelta(days=1), yesterday))


def reporting_range(range_value: str) -> tuple[datetime, datetime]:
    now = datetime.now(UTC)
    if range_value == "30d":
        start = now - timedelta(days=30)
        return start.replace(hour=0, minute=0, second=0, microsecond=0), now

    months = {"6m": 6, "12m": 12, "18m": 18}.get(range_value, 18)
    current_month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return add_months(current_month_start, -(months - 1)), now


def month_starts(start: datetime, end: datetime) -> list[datetime]:
    first = start.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    last = end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    months = []
    current = first
    while current <= last:
        months.append(current)
        current = add_months(current, 1)
    return months


def add_months(value: datetime, months: int) -> datetime:
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    return value.replace(year=year, month=month)


def period_label(month_start: datetime) -> str:
    return month_start.strftime("%B %Y")


def latest_capture_time(month_start: datetime, range_end: datetime) -> datetime:
    if month_start.year == range_end.year and month_start.month == range_end.month:
        return range_end
    return add_months(month_start, 1) - timedelta(hours=12)


def sample_submitted_at(
    month_start: datetime, enterprise_index: int, range_end: datetime
) -> datetime:
    """Reports go in late in their month, but never after the moment the data is generated."""
    planned = month_start.replace(
        day=min(18 + enterprise_index, 24), hour=9 + enterprise_index, minute=15
    )
    latest = max(month_start, range_end - timedelta(hours=enterprise_index + 1))
    return min(planned, latest)


def should_skip_target_report(
    month_start: datetime,
    current_month: datetime,
    enterprise_profile_id: str,
    target_enterprise_profile_id: str,
) -> bool:
    unsubmitted_months = {add_months(current_month, offset) for offset in range(-4, 1)}
    return (
        enterprise_profile_id == target_enterprise_profile_id and month_start in unsubmitted_months
    )


def seeded_review_status(month_start: datetime, current_month: datetime) -> str:
    open_months = {add_months(current_month, offset) for offset in range(-4, 1)}
    return "Ready to Consolidate" if month_start in open_months else "Consolidated"


def affected_row_count(result: Any) -> int:
    return int(getattr(result, "rowcount", 0) or 0)


def sample_uuid(*parts: str) -> str:
    return str(uuid5(SAMPLE_UUID_NAMESPACE, ":".join((SAMPLE_DATASET_VERSION, *parts))))
