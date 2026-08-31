from __future__ import annotations

import re
from calendar import month_abbr, month_name, monthrange
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field, model_validator

REPORTING_TIME_ZONE = ZoneInfo("Asia/Manila")
REPORTING_PERIOD_MONTH_RE = re.compile(
    r"^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})$"
)
MONTH_INDEX_BY_LABEL = {str(month_name[index]).lower(): index for index in range(1, 13)}


class MetricsSummaryResponse(BaseModel):
    entries: int
    exits: int
    peak_occupancy: int
    current_occupancy: int
    unique_count: int
    estimated_unique_count: int = 0
    confirmed_unique_count: int = 0
    degraded_unique_count: int = 0
    pending_unique_entries: int = 0
    repeat_entry_count: int = 0
    occupancy_correction_delta: int = 0
    total_events: int
    unsubmitted_events: int
    unsynced_events: int
    first_event_at: str | None = None
    last_event_at: str | None = None
    period: str | None = None


class OccupancyCorrectionRequest(BaseModel):
    new_occupancy: int = Field(ge=0, le=100_000)
    reason: str = Field(min_length=3, max_length=500)
    actor_id: str | None = Field(default=None, max_length=160)
    actor_name: str | None = Field(default=None, max_length=160)
    camera_id: int | None = None


class OccupancyCorrectionResponse(BaseModel):
    correction_id: str
    enterprise_id: str | None = None
    camera_id: int | None = None
    old_occupancy: int
    new_occupancy: int
    delta: int
    reason: str
    actor_id: str | None = None
    actor_name: str | None = None
    recorded_at: str


class HourlyMetricsPoint(BaseModel):
    time: str
    occupancy: int
    entry: int
    exit: int
    unique: int


class HistoricalMetricsPoint(BaseModel):
    label: str
    visitors: int
    entries: int
    exits: int
    peak_occupancy: int
    current_occupancy: int


class MetricsHistoryResponse(BaseModel):
    hourly_density: list[HourlyMetricsPoint]
    historical: dict[str, list[HistoricalMetricsPoint]]


def reporting_period_submission_error(period: str, now: datetime | None = None) -> str | None:
    period_end = _reporting_period_end_date(period)
    if period_end is None:
        return "Reporting period must use the Month YYYY format, for example June 2026."

    reference_time = now or datetime.now(REPORTING_TIME_ZONE)
    if reference_time.tzinfo is None:
        reference_time = reference_time.replace(tzinfo=REPORTING_TIME_ZONE)
    submitted_date = reference_time.astimezone(REPORTING_TIME_ZONE).date()
    opens_on = period_end + timedelta(days=1)
    if submitted_date >= opens_on:
        return None

    return (
        f"Submission opens on {_format_period_date(opens_on)} after the "
        f"{month_name[period_end.month]} {period_end.year} reporting period closes."
    )


def reporting_period_key(period: str) -> tuple[int, int] | None:
    period_end = _reporting_period_end_date(period)
    if period_end is None:
        return None
    return period_end.year, period_end.month


def _reporting_period_end_date(period: str) -> date | None:
    match = REPORTING_PERIOD_MONTH_RE.match(period.strip())
    if not match:
        return None
    month_label, year_label = match.groups()
    month = MONTH_INDEX_BY_LABEL.get(month_label.lower())
    if month is None:
        return None
    year = int(year_label)
    return date(year, month, monthrange(year, month)[1])


def _format_period_date(value: date) -> str:
    return f"{month_abbr[value.month]} {value.day}, {value.year}"


class ReportSubmissionMetrics(BaseModel):
    entries: int = Field(ge=0, le=100_000)
    exits: int = Field(ge=0, le=100_000)
    peak_occupancy: int = Field(ge=0, le=100_000)
    unique_count: int = Field(ge=0, le=100_000)

    @model_validator(mode="after")
    def validate_counts(self) -> ReportSubmissionMetrics:
        if self.exits > self.entries:
            raise ValueError("Total exits cannot exceed total entries.")
        return self


class ReportSubmissionRequest(BaseModel):
    report_id: str = Field(..., min_length=3, max_length=80)
    period: str = Field(min_length=1, max_length=120)
    notes: str | None = Field(default=None, max_length=5000)
    metrics: ReportSubmissionMetrics | None = None
    payload: dict | None = None

    @model_validator(mode="after")
    def validate_demographics(self) -> ReportSubmissionRequest:
        period_submission_error = reporting_period_submission_error(self.period)
        if period_submission_error:
            raise ValueError(period_submission_error)
        demo = (self.payload or {}).get("demo")
        fields = (
            "thisProvMale",
            "thisProvFemale",
            "otherProvMale",
            "otherProvFemale",
            "foreignMale",
            "foreignFemale",
        )
        if not isinstance(demo, dict) or any(
            str(demo.get(field, "")).strip() == "" for field in fields
        ):
            raise ValueError("All demographics fields are required.")
        if any(not str(demo[field]).strip().isdigit() for field in fields):
            raise ValueError("Demographics values must be non-negative whole numbers.")
        return self


class ReportCameraTotalResponse(BaseModel):
    camera_id: int | None = None
    camera_name: str | None = None
    entries: int
    exits: int
    peak_occupancy: int
    unique_count: int
    total_events: int


class ReportSubmissionResponse(MetricsSummaryResponse):
    report_id: str
    submission_id: str
    submitted_at: str
    sync_status: str
    camera_breakdown: list[ReportCameraTotalResponse] = Field(default_factory=list)


class ReportDraftRequest(BaseModel):
    period: str = Field(..., min_length=1, max_length=120)
    report_id: str | None = Field(default=None, max_length=80)
    payload: dict = Field(default_factory=dict)


class ReportDraftResponse(ReportDraftRequest):
    draft_key: str
    updated_at: str


class SamplePrepareRequest(BaseModel):
    report_id: str = Field(..., min_length=1, max_length=80)
    enterprise_id: str = Field(..., min_length=1, max_length=160)
    enterprise_name: str | None = Field(default=None, max_length=160)
    entries: int = Field(ge=1, le=100_000)
    exits: int = Field(ge=0, le=100_000)
    unique_count: int = Field(ge=0, le=100_000)
    peak_occupancy: int = Field(ge=1, le=100_000)
    period: str = Field(min_length=1, max_length=120)


class SamplePrepareResponse(MetricsSummaryResponse):
    enterprise_id: str
    enterprise_name: str | None = None
    period: str | None = None
    prepared: bool = True


class ReportSubmissionRecordResponse(BaseModel):
    report_id: str
    submission_id: str
    period: str
    submitted_at: str
    entries: int
    exits: int
    peak_occupancy: int
    unique_count: int
    notes: str | None = None
    payload: dict = Field(default_factory=dict)
    sync_status: str
    synced_at: str | None = None
    raw_purged_at: str | None = None
    camera_breakdown: list[ReportCameraTotalResponse] = Field(default_factory=list)


class ReportRawDataPurgeResponse(BaseModel):
    report_id: str
    purged_events: int
    raw_purged_at: str | None = None


class SyncMarkResponse(BaseModel):
    updated: int
