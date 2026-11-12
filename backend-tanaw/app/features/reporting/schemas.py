from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.features.reporting.counting import counting_metrics
from app.features.reporting.periods import reporting_period_submission_error


class DesktopReportSubmissionIngest(BaseModel):
    submissionId: UUID
    reportId: str = Field(min_length=3, max_length=80)
    period: str = Field(min_length=1, max_length=120)
    submittedAt: datetime
    entries: int | None = Field(ge=0)
    exits: int | None = Field(ge=0)
    peakOccupancy: int | None = Field(ge=0)
    uniqueCount: int = Field(ge=0)
    notes: str | None = Field(default=None, max_length=5000)
    syncStatus: str | None = Field(default=None, max_length=60)
    payload: dict = Field(
        description="Frozen establishment counting snapshot, matching metrics, and demographic allocation."
    )

    @model_validator(mode="after")
    def validate_report_metrics(self) -> DesktopReportSubmissionIngest:
        period_submission_error = reporting_period_submission_error(self.period, self.submittedAt)
        if period_submission_error:
            raise ValueError(period_submission_error)
        expected = counting_metrics((self.payload or {}).get("counting"), self.period)
        if (self.entries, self.exits, self.peakOccupancy, self.uniqueCount) != expected:
            raise ValueError("Report metrics must match the frozen establishment snapshot.")
        metrics = (self.payload or {}).get("metrics")
        if metrics != dict(zip(("entries", "exits", "peak", "unique"), expected, strict=True)):
            raise ValueError("Payload metrics must match the frozen establishment snapshot.")
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
    metrics: dict[str, int | str | None]
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
    entry: int | None
    exit: int | None
    counting: dict | None = None
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
    totalEntry: int | None
    totalExit: int | None
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
