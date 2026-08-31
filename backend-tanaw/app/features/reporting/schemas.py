from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.features.reporting.periods import reporting_period_submission_error


def _report_metrics_from_payload(
    payload: dict | None,
) -> tuple[int, int, int, int] | None:
    metrics = payload.get("metrics") if isinstance(payload, dict) else None
    if not isinstance(metrics, dict):
        return None

    entries = _non_negative_int(metrics.get("entries"))
    exits = _non_negative_int(metrics.get("exits"))
    peak_occupancy = _non_negative_int(
        _first_present(metrics, "peak", "peakOccupancy", "peak_occupancy")
    )
    unique_count = _non_negative_int(
        _first_present(metrics, "unique", "uniqueCount", "unique_count")
    )
    if entries is None or exits is None or peak_occupancy is None or unique_count is None:
        return None
    return entries, min(exits, entries), peak_occupancy, unique_count


def _non_negative_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value)
    return None


def _first_present(values: dict, *keys: str) -> object:
    for key in keys:
        if key in values:
            return values[key]
    return None


class DesktopReportSubmissionIngest(BaseModel):
    submissionId: UUID
    reportId: str = Field(min_length=3, max_length=80)
    period: str = Field(min_length=1, max_length=120)
    submittedAt: datetime
    entries: int = Field(default=0, ge=0)
    exits: int = Field(default=0, ge=0)
    peakOccupancy: int = Field(default=0, ge=0)
    uniqueCount: int = Field(default=0, ge=0)
    notes: str | None = Field(default=None, max_length=5000)
    syncStatus: str | None = Field(default=None, max_length=60)
    payload: dict | None = None

    @model_validator(mode="after")
    def validate_report_metrics(self) -> DesktopReportSubmissionIngest:
        payload_metrics = _report_metrics_from_payload(self.payload)
        if payload_metrics is not None:
            self.entries, self.exits, self.peakOccupancy, self.uniqueCount = payload_metrics
        if self.exits > self.entries:
            raise ValueError("Total exits cannot exceed total entries.")
        period_submission_error = reporting_period_submission_error(self.period, self.submittedAt)
        if period_submission_error:
            raise ValueError(period_submission_error)
        demo = (self.payload or {}).get("demo")
        required_demo_fields = {
            "thisProvMale",
            "thisProvFemale",
            "otherProvMale",
            "otherProvFemale",
            "foreignMale",
            "foreignFemale",
        }
        if not isinstance(demo, dict):
            raise ValueError("Demographics are required.")
        demographic_total = 0
        for field in required_demo_fields:
            raw_value = str(demo.get(field, "")).strip()
            if raw_value == "":
                continue
            if not raw_value.isdigit():
                raise ValueError("Demographics values must be non-negative whole numbers.")
            demographic_total += int(raw_value)
        if demographic_total > self.uniqueCount:
            raise ValueError("Demographic totals cannot exceed the unique visitor count.")
        if demographic_total < self.uniqueCount:
            raise ValueError(
                "Demographic totals must match the unique visitor count before submission."
            )
        return self


class SamplePreparationCounts(BaseModel):
    entries: int = Field(ge=0)
    exits: int = Field(ge=0)
    uniqueCount: int = Field(ge=0)
    peakOccupancy: int = Field(ge=0)
    period: str
    reportId: str = Field(min_length=3, max_length=80)


class SamplePreparationSummary(BaseModel):
    enterpriseId: str
    enterpriseName: str
    counts: SamplePreparationCounts | None = None
    pendingCounts: list[SamplePreparationCounts] = Field(default_factory=list)


ReportReviewStatus = Literal["Pending Review", "Ready to Consolidate", "Returned", "Consolidated"]


class ReportStatusUpdate(BaseModel):
    status: ReportReviewStatus
    remarks: str | None = Field(default=None, max_length=2000)


class ReportDemographicsSummary(BaseModel):
    thisProvMale: int = Field(ge=0)
    thisProvFemale: int = Field(ge=0)
    otherProvMale: int = Field(ge=0)
    otherProvFemale: int = Field(ge=0)
    foreignMale: int = Field(ge=0)
    foreignFemale: int = Field(ge=0)


class IntakeReportSummary(BaseModel):
    id: str
    enterpriseId: str
    enterprise: str
    category: str
    barangay: str
    month: str
    period: str
    submitted: str
    submittedAt: datetime
    status: ReportReviewStatus
    code: str
    remarks: str | None = None
    notes: str | None = None
    metrics: dict[str, int | str]
    payload: dict | None = None
    demographics: ReportDemographicsSummary | None = None


FinalReportArchivedFromStatus = Literal["Draft", "Finalized", "Returned for Revision"]
FinalReportStatus = Literal["Draft", "Finalized", "Archived", "Returned for Revision"]
OperationalAlertUrgency = Literal["Normal", "Important", "Urgent"]


class FinalReportSourceSummary(BaseModel):
    id: str
    enterprise: str
    code: str
    unique: int
    entry: int
    exit: int
    demographics: ReportDemographicsSummary | None = None


class FinalReportSummary(BaseModel):
    id: str
    title: str
    period: str
    generatedOn: str
    preparedBy: str
    preparedRole: str
    status: FinalReportStatus
    archivedFromStatus: FinalReportArchivedFromStatus | None = None
    totalEntry: int
    totalExit: int
    totalUnique: int
    enterpriseCount: int
    sources: list[FinalReportSourceSummary]


class FinalReportCreate(BaseModel):
    reportIds: list[str] = Field(min_length=1, max_length=500)
    preparedBy: str = Field(min_length=1, max_length=120)

    @field_validator("reportIds")
    @classmethod
    def validate_unique_report_ids(cls, value: list[str]) -> list[str]:
        normalized_ids = [item.strip() for item in value if item.strip()]
        if len(normalized_ids) != len(value):
            raise ValueError("Report IDs cannot be blank.")
        if len(normalized_ids) != len(set(normalized_ids)):
            raise ValueError("Report IDs must be unique.")
        return normalized_ids


class FinalReportStatusUpdate(BaseModel):
    status: FinalReportStatus


class FinalReportRevisionReturn(BaseModel):
    sourceReportIds: list[str] = Field(min_length=1, max_length=500)
    remarks: str = Field(min_length=5, max_length=2000)

    @field_validator("sourceReportIds")
    @classmethod
    def validate_unique_source_report_ids(cls, value: list[str]) -> list[str]:
        normalized_ids = [item.strip() for item in value if item.strip()]
        if len(normalized_ids) != len(value):
            raise ValueError("Source report IDs cannot be blank.")
        if len(normalized_ids) != len(set(normalized_ids)):
            raise ValueError("Source report IDs must be unique.")
        return normalized_ids
