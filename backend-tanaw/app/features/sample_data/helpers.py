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


# Day of the following month on which each enterprise (by position) sends its monthly report.
# Reports are due on the 10th, so the 12th and 13th arrive late.
SUBMISSION_DAYS = (2, 4, 5, 7, 9, 13, 3, 6, 8, 12)


def sample_submitted_at(
    month_start: datetime, enterprise_index: int, range_end: datetime
) -> datetime | None:
    """When a month's report is sent: after the month closes, between the 2nd and the 13th of the
    next month. None when that moment has not come yet, so the report is still pending."""
    planned = add_months(month_start, 1).replace(
        day=SUBMISSION_DAYS[enterprise_index % len(SUBMISSION_DAYS)],
        hour=1 + enterprise_index % 8,
        minute=15,
    )
    return planned if planned <= range_end else None


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


# Enterprise positions whose reporting-month (the month just closed) report is still waiting for
# staff to accept it. The other reporting-month reports are accepted.
REPORTING_MONTH_PENDING_INDEXES = frozenset({1, 2, 4})
# An enterprise (by position) that has not sent its reporting-month report at all.
MISSING_REPORT_ENTERPRISE_INDEX = 9
# Reporting-month reports staff returned for correction, by enterprise position, with the reason
# staff gave. The corrected report from CORRECTED_REPORT_ENTERPRISE_INDEX has arrived as version 2
# and waits for staff; the other returned report is still awaiting its correction.
RETURNED_REPORT_REASONS = {
    2: (
        "The foreign visitor figures look swapped between male and female. Please check them "
        "against the camera log and send the report again."
    ),
    3: (
        "The visitor origins for the last week add up to more than that week's unique visitors. "
        "Please recount This Province and Other Provinces, then send the corrected report."
    ),
}
CORRECTED_REPORT_ENTERPRISE_INDEX = 2


def seeded_review_status(
    month_start: datetime, current_month: datetime, enterprise_index: int = 0
) -> str:
    """Older months are consolidated into finalized monthly reports. The three months before the
    reporting month are accepted and wait for the target enterprise's late reports. The reporting
    month has some reports waiting for staff and the rest accepted. The month in progress has no
    reports yet."""
    if month_start >= current_month:
        return "Pending Review"
    if month_start == add_months(current_month, -1):
        return (
            "Pending Review"
            if enterprise_index in REPORTING_MONTH_PENDING_INDEXES
            else "Ready to Consolidate"
        )
    open_months = {add_months(current_month, offset) for offset in range(-4, -1)}
    return "Ready to Consolidate" if month_start in open_months else "Consolidated"


def sample_return_reason(
    month_start: datetime, current_month: datetime, enterprise_index: int
) -> str | None:
    """Why staff returned this enterprise's report for correction, or None when they did not."""
    if month_start != add_months(current_month, -1):
        return None
    return RETURNED_REPORT_REASONS.get(enterprise_index)


def affected_row_count(result: Any) -> int:
    return int(getattr(result, "rowcount", 0) or 0)


def sample_uuid(*parts: str) -> str:
    return str(uuid5(SAMPLE_UUID_NAMESPACE, ":".join((SAMPLE_DATASET_VERSION, *parts))))
