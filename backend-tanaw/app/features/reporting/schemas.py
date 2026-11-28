from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from app.features.accounts.attractions import AttractionClassification
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
            # This Province visitors whose sex was not recorded. Optional.
            "thisProvUnspecified",
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


ReportReviewStatus = Literal["Pending Review", "Ready to Consolidate", "Consolidated"]


class ReportStatusUpdate(BaseModel):
    status: ReportReviewStatus
    remarks: str | None = Field(default=None, max_length=2000)


class ReportDemographicsSummary(BaseModel):
    thisProvMale: int = Field(ge=0)
    thisProvFemale: int = Field(ge=0)
    thisProvUnspecified: int = Field(
        default=0,
        ge=0,
        description="This Province visitors whose sex was not recorded.",
    )
    otherProvMale: int = Field(ge=0)
    otherProvFemale: int = Field(ge=0)
    foreignMale: int = Field(ge=0)
    foreignFemale: int = Field(ge=0)
    thisCityMale: int | None = Field(
        default=None,
        ge=0,
        description="This City/Municipality share of thisProvMale; null when not recorded.",
    )
    thisCityFemale: int | None = Field(
        default=None,
        ge=0,
        description="This City/Municipality share of thisProvFemale; null when not recorded.",
    )
    thisCityUnspecified: int | None = Field(
        default=None,
        ge=0,
        description="This City/Municipality share of thisProvUnspecified; null when not recorded.",
    )


class IntakeReportSummary(BaseModel):
    id: str
    enterpriseId: str
    enterprise: str
    category: str
    attraction: AttractionClassification
    attractionDescription: str | None = None
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


FinalReportArchivedFromStatus = Literal["Draft", "Finalized"]
FinalReportStatus = Literal["Draft", "Finalized", "Archived"]
OperationalAlertUrgency = Literal["Normal", "Important", "Urgent"]


class FinalReportSourceSummary(BaseModel):
    id: str
    enterpriseProfileId: str
    enterprise: str
    attractionCode: str
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
    generatedAt: datetime = Field(description="When the report was first generated.")
    updatedAt: datetime = Field(
        description="When the report last changed: reports added to a draft, finalized or archived."
    )
    preparedBy: str
    preparedRole: str
    status: FinalReportStatus = Field(
        description=(
            "Draft while some enterprises have not sent their report or some sent reports await "
            "review; Finalized once every expected enterprise's report is included."
        )
    )
    archivedFromStatus: FinalReportArchivedFromStatus | None = None
    totalEntry: int | None
    totalExit: int | None
    totalUnique: int
    enterpriseCount: int = Field(description="Enterprises whose reports are included.")
    enterpriseTotal: int = Field(
        description=(
            "Enterprises expected to report for the month when the report was last generated: the "
            "active enterprises plus any other enterprise that sent a report for the month."
        )
    )
    sources: list[FinalReportSourceSummary]


class FinalReportCreate(BaseModel):
    """Consolidates a month's accepted reports. With no consolidated report for the month yet, this
    creates one; with a Draft, it adds the given reports to it. The result is Finalized when every
    expected enterprise's report is included, and a Draft otherwise."""

    reportIds: list[str] = Field(
        default_factory=list,
        max_length=500,
        description="Accepted (Ready to Consolidate) reports to include; may be empty with period.",
    )
    preparedBy: str = Field(min_length=1, max_length=120)
    period: str | None = Field(
        default=None,
        min_length=1,
        max_length=120,
        description=(
            "The reporting month, for example October 2026. Required when reportIds is empty, to "
            "finalize a month's draft that has nothing new to add."
        ),
    )

    @model_validator(mode="after")
    def validate_reports_or_period(self) -> FinalReportCreate:
        if not self.reportIds and self.period is None:
            raise ValueError("Choose at least one accepted report or the reporting month.")
        return self

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
