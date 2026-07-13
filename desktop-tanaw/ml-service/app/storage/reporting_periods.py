from __future__ import annotations

import re
from calendar import month_abbr, monthrange
from dataclasses import dataclass
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

REPORTING_TIMEZONE_NAME = "Asia/Manila"
REPORTING_TIMEZONE = ZoneInfo(REPORTING_TIMEZONE_NAME)

_CANONICAL_PERIOD_ID_RE = re.compile(
    r"^month:Asia/Manila:(?P<year>\d{4})-(?P<month>0[1-9]|1[0-2])$"
)
_PERIOD_RANGE_RE = re.compile(
    r"^(?P<start_month>[A-Za-z]+)\s+(?P<start_day>\d{1,2})\s*-\s*"
    r"(?:(?P<end_month>[A-Za-z]+)\s+)?(?P<end_day>\d{1,2}),\s*(?P<year>\d{4})$"
)
_PERIOD_MONTH_RE = re.compile(r"^(?P<month>[A-Za-z]+)\s+(?P<year>\d{4})$")
_MONTH_INDEX_BY_LABEL = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}


@dataclass(frozen=True)
class ReportingPeriod:
    period_id: str
    timezone: str
    business_start_date: date
    business_end_date_exclusive: date
    starts_at_utc: datetime
    ends_at_utc: datetime
    label: str

    def contains(self, captured_at: datetime) -> bool:
        normalized = normalize_captured_at(captured_at)
        return self.starts_at_utc <= normalized < self.ends_at_utc


def monthly_period_for_captured_at(captured_at: datetime | str) -> ReportingPeriod:
    normalized = parse_captured_at(captured_at)
    local_captured_at = normalized.astimezone(REPORTING_TIMEZONE)
    return monthly_period(local_captured_at.year, local_captured_at.month)


def monthly_period(year: int, month: int) -> ReportingPeriod:
    if month < 1 or month > 12:
        raise ValueError("Reporting period month must be between 1 and 12.")

    next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
    local_start = datetime(year, month, 1, tzinfo=REPORTING_TIMEZONE)
    local_end = datetime(next_year, next_month, 1, tzinfo=REPORTING_TIMEZONE)
    last_day = monthrange(year, month)[1]
    return ReportingPeriod(
        period_id=f"month:{REPORTING_TIMEZONE_NAME}:{year:04d}-{month:02d}",
        timezone=REPORTING_TIMEZONE_NAME,
        business_start_date=local_start.date(),
        business_end_date_exclusive=local_end.date(),
        starts_at_utc=local_start.astimezone(UTC),
        ends_at_utc=local_end.astimezone(UTC),
        label=f"{month_abbr[month]} 1 - {month_abbr[month]} {last_day}, {year}",
    )


def monthly_period_from_id(period_id: str) -> ReportingPeriod | None:
    match = _CANONICAL_PERIOD_ID_RE.fullmatch(period_id.strip())
    if match is None:
        return None
    return monthly_period(int(match.group("year")), int(match.group("month")))


def monthly_period_from_identity(
    period_id: str,
    starts_at_utc: datetime | str,
    ends_at_utc: datetime | str,
) -> ReportingPeriod:
    period = monthly_period_from_id(period_id)
    if period is None:
        raise ValueError("Reporting period ID must use month:Asia/Manila:YYYY-MM.")
    supplied_start = parse_captured_at(starts_at_utc)
    supplied_end = parse_captured_at(ends_at_utc)
    if supplied_start != period.starts_at_utc or supplied_end != period.ends_at_utc:
        raise ValueError(
            "Reporting period UTC bounds do not match the exact Asia/Manila "
            "calendar window for the canonical period ID."
        )
    return period


def monthly_period_from_label(label: str) -> ReportingPeriod | None:
    normalized = label.strip()
    canonical = monthly_period_from_id(normalized)
    if canonical is not None:
        return canonical

    month_match = _PERIOD_MONTH_RE.fullmatch(normalized)
    if month_match is not None:
        month = _month_index(month_match.group("month"))
        if month is None:
            return None
        return monthly_period(int(month_match.group("year")), month)

    range_match = _PERIOD_RANGE_RE.fullmatch(normalized)
    if range_match is None:
        return None

    start_month = _month_index(range_match.group("start_month"))
    end_month_label = range_match.group("end_month")
    end_month = _month_index(end_month_label) if end_month_label else start_month
    if start_month is None or end_month != start_month:
        return None

    year = int(range_match.group("year"))
    expected_last_day = monthrange(year, start_month)[1]
    if int(range_match.group("start_day")) != 1:
        return None
    if int(range_match.group("end_day")) != expected_last_day:
        return None
    return monthly_period(year, start_month)


def parse_captured_at(value: datetime | str) -> datetime:
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("Captured time must be a valid ISO-8601 timestamp.") from exc
    else:
        parsed = value
    return normalize_captured_at(parsed)


def normalize_captured_at(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Captured time must include a UTC offset.")
    return value.astimezone(UTC)


def _month_index(label: str) -> int | None:
    return _MONTH_INDEX_BY_LABEL.get(label.strip().lower())
