from __future__ import annotations

import re
from calendar import month_abbr, month_name, monthrange
from datetime import date, datetime, timedelta
from typing import Any, Literal
from uuid import UUID
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


def one_report_per_month_error(period: str) -> str:
    """Why a second report for a reporting month is refused; matches the backend's wording."""
    return (
        f"A report for {period} has already been submitted. An enterprise sends one report "
        "per reporting month, and a submitted report cannot be replaced."
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
    entries: int | None = Field(ge=0, le=100_000)
    exits: int | None = Field(ge=0, le=100_000)
    peak_occupancy: int | None = Field(ge=0, le=100_000)
    unique_count: int = Field(ge=0, le=100_000)


class ReportSubmissionRequest(BaseModel):
    request_id: UUID | None = None
    expected_snapshot_version: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
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
        if not isinstance(demo, dict) or any(field not in demo for field in fields):
            raise ValueError("All demographics fields are required.")
        # This Province visitors whose sex was not recorded; optional.
        all_fields = (*fields, "thisProvUnspecified")
        demo = {
            field: "0" if demo.get(field) in (None, "") else demo[field] for field in all_fields
        }
        if any(not str(demo[field]).strip().isdigit() for field in all_fields):
            raise ValueError("Demographics values must be non-negative whole numbers.")
        assert self.payload is not None
        self.payload["demo"] = demo
        return self


class ReportCameraTotalResponse(BaseModel):
    camera_id: int | None = None
    camera_name: str | None = None
    entries: int
    exits: int
    peak_occupancy: int
    unique_count: int
    total_events: int


class ReportSubmissionResponse(BaseModel):
    report_id: str
    submission_id: str
    # The month's report version on this computer: 1, then one more for each correction Staff
    # asked for. TANAW's own version number is authoritative once the report reaches it.
    version: int = Field(default=1, ge=1)
    submitted_at: str
    sync_status: str
    period: str
    entries: int | None
    exits: int | None
    peak_occupancy: int | None
    unique_count: int
    payload: dict
    counting: dict
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
    period: str = Field(min_length=1, max_length=120)


class SamplePrepareResponse(BaseModel):
    enterprise_id: str
    enterprise_name: str | None = None
    period: str
    prepared: bool
    days: int


class ReportSubmissionRecordResponse(BaseModel):
    report_id: str
    submission_id: str
    period: str
    submitted_at: str
    entries: int | None
    exits: int | None
    peak_occupancy: int | None
    unique_count: int
    notes: str | None = None
    payload: dict = Field(default_factory=dict)
    sync_status: str
    synced_at: str | None = None
    raw_purged_at: str | None = None
    version: int = Field(default=1, ge=1)
    # TANAW's reason for refusing the upload, when it gave one.
    rejection_reason: str | None = None
    # Set once the version is reopened for correction; it then stays saved as history.
    reopened_at: str | None = None
    reopen_reason: Literal["returned", "upload_rejected"] | None = None
    camera_breakdown: list[ReportCameraTotalResponse] = Field(default_factory=list)


class ReportUploadRejectedRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=2000)


class ReportReopenRequest(BaseModel):
    """Why the report is reopened: Staff returned it, or TANAW refused its upload."""

    reason: Literal["returned", "upload_rejected"]


class ReportRawDataPurgeResponse(BaseModel):
    report_id: str
    purged_events: int
    raw_purged_at: str | None = None


class SyncMarkResponse(BaseModel):
    updated: int


class LocalBackupDay(BaseModel):
    business_date: date
    finalized: bool
    metrics: dict[str, Any]


class LocalBackupDraft(BaseModel):
    draft_key: str = Field(min_length=1, max_length=120)
    period: str = Field(min_length=1, max_length=120)
    report_id: str | None = Field(default=None, max_length=120)
    payload: dict[str, Any]
    updated_at: str = Field(min_length=1, max_length=40)


class LocalBackupCameraTotal(BaseModel):
    camera_id: int | None = None
    camera_name: str | None = Field(default=None, max_length=120)
    entries: int = Field(ge=0)
    exits: int = Field(ge=0)
    peak_occupancy: int = Field(ge=0)
    unique_count: int = Field(ge=0)


class LocalBackupSubmission(BaseModel):
    """A submitted report still waiting to upload, with its original IDs."""

    report_id: str = Field(min_length=1, max_length=120)
    submission_id: str = Field(min_length=1, max_length=120)
    period: str = Field(min_length=1, max_length=40)
    submitted_at: str = Field(min_length=1, max_length=40)
    entries: int | None = Field(default=None, ge=0)
    exits: int | None = Field(default=None, ge=0)
    peak_occupancy: int | None = Field(default=None, ge=0)
    unique_count: int = Field(default=0, ge=0)
    notes: str | None = Field(default=None, max_length=4000)
    payload: dict[str, Any]
    camera_breakdown: list[LocalBackupCameraTotal] = Field(default_factory=list, max_length=32)


class LocalBackupState(BaseModel):
    """Whether this computer merged the server copy, and which server revision it saw last."""

    reconciled: bool
    server_revision: int | None


class LocalBackupResponse(BaseModel):
    """Unsubmitted report data and allowlisted camera settings for the server backup."""

    enterprise_id: str | None
    state: LocalBackupState
    days: list[LocalBackupDay]
    drafts: list[LocalBackupDraft]
    submissions: list[LocalBackupSubmission]
    cameras: list[dict[str, Any]]


class LocalBackupRestoreRequest(BaseModel):
    enterprise_id: str = Field(min_length=1, max_length=160)
    expected_revision: int | None = Field(ge=1)
    server_revision: int = Field(ge=1)
    days: list[LocalBackupDay] = Field(default_factory=list, max_length=62)
    drafts: list[LocalBackupDraft] = Field(default_factory=list, max_length=12)
    submissions: list[LocalBackupSubmission] = Field(default_factory=list, max_length=12)
    cameras: list[dict[str, Any]] = Field(default_factory=list, max_length=32)


class LocalBackupRestoreResponse(BaseModel):
    restored: bool
    days: int
    drafts: int
    submissions: int
    cameras: int
    custom_cameras: int


class LocalBackupRevisionRequest(BaseModel):
    enterprise_id: str = Field(min_length=1, max_length=160)
    expected_revision: int | None = Field(ge=1)
    server_revision: int | None = Field(ge=1)
