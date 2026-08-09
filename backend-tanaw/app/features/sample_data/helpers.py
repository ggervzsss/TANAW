from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid5

from app.features.sample_data.dataset import SAMPLE_DATASET_VERSION
from app.features.sample_data.definitions import SAMPLE_UUID_NAMESPACE


def build_demographic_breakdown(
    unique_count: int, enterprise_index: int, month_index: int
) -> dict[str, str]:
    this_province_share = 58 + (enterprise_index % 4) * 2
    other_province_share = 27 + (month_index % 3) * 2
    this_province_total = unique_count * this_province_share // 100
    other_province_total = unique_count * other_province_share // 100
    if this_province_total + other_province_total > unique_count:
        other_province_total = max(0, unique_count - this_province_total)
    foreign_total = unique_count - this_province_total - other_province_total

    this_prov_male, this_prov_female = split_gender(
        this_province_total, 48 + ((enterprise_index + month_index) % 5)
    )
    other_prov_male, other_prov_female = split_gender(
        other_province_total, 49 + ((enterprise_index * 2 + month_index) % 4)
    )
    foreign_male, foreign_female = split_gender(
        foreign_total, 52 + ((enterprise_index + month_index * 2) % 4)
    )
    return {
        "thisProvMale": str(this_prov_male),
        "thisProvFemale": str(this_prov_female),
        "otherProvMale": str(other_prov_male),
        "otherProvFemale": str(other_prov_female),
        "foreignMale": str(foreign_male),
        "foreignFemale": str(foreign_female),
    }


def split_gender(total: int, male_percent: int) -> tuple[int, int]:
    male = max(0, min(total, total * male_percent // 100))
    return male, total - male


def reporting_range(range_value: str) -> tuple[datetime, datetime]:
    now = datetime.now(UTC)
    if range_value == "30d":
        start = now - timedelta(days=30)
        return start.replace(hour=0, minute=0, second=0, microsecond=0), now

    months = 12 if range_value == "12m" else 6
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


def category_label(value: str | None) -> str:
    return {"events venue": "Events Venue", "tourism": "Tourism", "business": "Business"}.get(
        value or "", "Uncategorized"
    )


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
