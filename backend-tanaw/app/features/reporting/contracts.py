from __future__ import annotations

import re
from calendar import month_name
from dataclasses import dataclass
from datetime import UTC, date, datetime
from enum import StrEnum
from zoneinfo import ZoneInfo

REPORTING_TIMEZONE_NAME = "Asia/Manila"
REPORTING_TIMEZONE = ZoneInfo(REPORTING_TIMEZONE_NAME)
MONTHLY_PERIOD_KEY = re.compile(r"^month:Asia/Manila:(?P<year>[0-9]{4})-(?P<month>[0-9]{2})$")


class MetricGrain(StrEnum):
    CAMERA = "camera"
    SITE = "site"
    ENTERPRISE = "enterprise"


class MetricProvenance(StrEnum):
    CAMERA_DERIVED = "camera_derived"
    OPERATOR_ENTERED = "operator_entered"
    SYSTEM_DERIVED = "system_derived"


class MetricQuality(StrEnum):
    CONFIRMED = "confirmed"
    DEGRADED = "degraded"
    ESTIMATED = "estimated"
    UNKNOWN = "unknown"


class ReportWorkflowState(StrEnum):
    SUBMITTED = "submitted"
    RETURNED = "returned"
    ACCEPTED = "accepted"
    CONSOLIDATED = "consolidated"


class FinalReportScope(StrEnum):
    CITYWIDE = "citywide"
    BARANGAY = "barangay"
    ENTERPRISE_SELECTION = "enterprise_selection"


@dataclass(frozen=True, slots=True)
class MetricDefinition:
    key: str
    unit: str
    grain: MetricGrain
    aggregation: str
    description: str
    distinct_across_enterprises: bool = False


METRIC_CATALOG = {
    "entries": MetricDefinition(
        key="entries",
        unit="events",
        grain=MetricGrain.SITE,
        aggregation="sum",
        description="Tripwire entry events observed during the reporting window.",
    ),
    "exits": MetricDefinition(
        key="exits",
        unit="events",
        grain=MetricGrain.SITE,
        aggregation="sum",
        description="Tripwire exit events observed during the reporting window.",
    ),
    "current_occupancy": MetricDefinition(
        key="current_occupancy",
        unit="people-estimate",
        grain=MetricGrain.SITE,
        aggregation="latest-fresh-value",
        description="Fresh site occupancy estimate; unavailable after the live-state TTL.",
    ),
    "peak_occupancy": MetricDefinition(
        key="peak_occupancy",
        unit="people-estimate",
        grain=MetricGrain.SITE,
        aggregation="maximum",
        description="Maximum observed site occupancy during the reporting window.",
    ),
    "unique_visitor_estimate": MetricDefinition(
        key="unique_visitor_estimate",
        unit="visitor-estimate",
        grain=MetricGrain.SITE,
        aggregation="method-version-specific",
        description=(
            "Privacy-preserving site-local visitor estimate. Values from different enterprises "
            "are not a distinct citywide-person count."
        ),
        distinct_across_enterprises=False,
    ),
}


@dataclass(frozen=True, slots=True)
class CanonicalReportingPeriod:
    natural_key: str
    cadence: str
    timezone: str
    local_start_date: date
    local_end_date: date
    starts_at: datetime
    ends_at: datetime
    label: str

    def contains(self, timestamp: datetime) -> bool:
        observed_at = _aware_timestamp(timestamp)
        return self.starts_at <= observed_at < self.ends_at


def monthly_reporting_period(year: int, month: int) -> CanonicalReportingPeriod:
    if year < 1 or year > 9999:
        raise ValueError("Reporting-period year must be between 1 and 9999.")
    if month < 1 or month > 12:
        raise ValueError("Reporting-period month must be between 1 and 12.")

    next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
    local_start = datetime(year, month, 1, tzinfo=REPORTING_TIMEZONE)
    local_end = datetime(next_year, next_month, 1, tzinfo=REPORTING_TIMEZONE)
    return CanonicalReportingPeriod(
        natural_key=f"month:{REPORTING_TIMEZONE_NAME}:{year:04d}-{month:02d}",
        cadence="month",
        timezone=REPORTING_TIMEZONE_NAME,
        local_start_date=local_start.date(),
        local_end_date=local_end.date(),
        starts_at=local_start.astimezone(UTC),
        ends_at=local_end.astimezone(UTC),
        label=f"{month_name[month]} {year:04d}",
    )


def reporting_period_for_timestamp(timestamp: datetime) -> CanonicalReportingPeriod:
    observed_at = _aware_timestamp(timestamp)
    local_timestamp = observed_at.astimezone(REPORTING_TIMEZONE)
    return monthly_reporting_period(local_timestamp.year, local_timestamp.month)


def reporting_period_from_key(natural_key: str) -> CanonicalReportingPeriod:
    match = MONTHLY_PERIOD_KEY.fullmatch(natural_key)
    if match is None:
        raise ValueError("Reporting-period key must use month:Asia/Manila:YYYY-MM.")
    return monthly_reporting_period(int(match.group("year")), int(match.group("month")))


def _aware_timestamp(timestamp: datetime) -> datetime:
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise ValueError("Reporting timestamps must include a UTC offset.")
    return timestamp.astimezone(UTC)
