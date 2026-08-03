import re
from calendar import month_abbr, month_name, monthrange
from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

REPORTING_TIME_ZONE = ZoneInfo("Asia/Manila")
REPORTING_PERIOD_MONTH_RE = re.compile(
    r"^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$"
)
MONTH_INDEX_BY_LABEL = {
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "may": 5,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}


def reporting_period_submission_error(period: str, submitted_at: datetime) -> str | None:
    period_end = _reporting_period_end_date(period)
    if period_end is None:
        return "Reporting period must use the Month YYYY format, for example June 2026."

    submitted_date = _reporting_date(submitted_at)
    opens_on = period_end + timedelta(days=1)
    if submitted_date >= opens_on:
        return None

    return (
        f"Submission opens on {_format_period_date(opens_on)} after the "
        f"{month_name[period_end.month]} {period_end.year} reporting period closes."
    )


def reporting_period_key(period: str) -> str | None:
    period_end = _reporting_period_end_date(period)
    if period_end is None:
        return None
    return f"{period_end.year:04d}-{period_end.month:02d}"


def _reporting_period_end_date(period: str) -> date | None:
    normalized_period = period.strip()
    month_year_match = REPORTING_PERIOD_MONTH_RE.match(normalized_period)
    if month_year_match:
        month_label, year_label = month_year_match.groups()
        month = _month_number(month_label)
        if month is None:
            return None
        year = int(year_label)
        return date(year, month, monthrange(year, month)[1])
    return None


def _month_number(month_label: str) -> int | None:
    return MONTH_INDEX_BY_LABEL.get(month_label.lower())


def _reporting_date(value: datetime) -> date:
    aware_value = value.replace(tzinfo=UTC) if value.tzinfo is None else value
    return aware_value.astimezone(REPORTING_TIME_ZONE).date()


def _format_period_date(value: date) -> str:
    return f"{month_abbr[value.month]} {value.day}, {value.year}"
