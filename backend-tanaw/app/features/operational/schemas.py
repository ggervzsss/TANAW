from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

SourceKind = Literal["real", "mock", "hybrid"]


class DesktopMetricsSummary(BaseModel):
    entries: int = Field(default=0, ge=0)
    exits: int = Field(default=0, ge=0)
    peakOccupancy: int = Field(default=0, ge=0)
    currentOccupancy: int = Field(default=0, ge=0)
    uniqueCount: int = Field(default=0, ge=0)
    confirmedUniqueCount: int = Field(default=0, ge=0)
    degradedUniqueCount: int = Field(default=0, ge=0)
    totalEvents: int = Field(default=0, ge=0)
    unsubmittedEvents: int = Field(default=0, ge=0)
    unsyncedEvents: int = Field(default=0, ge=0)
    firstEventAt: datetime | None = None
    lastEventAt: datetime | None = None


class DesktopSessionSummary(BaseModel):
    running: bool = False
    status: str = Field(default="unknown", max_length=40)
    error: str | None = Field(default=None, max_length=1000)
    cameraId: int | str | None = None
    cameraName: str | None = Field(default=None, max_length=120)
    updatedAt: datetime | None = None


class DesktopHealthSummary(BaseModel):
    analyticsFps: float | None = Field(default=None, ge=0)
    processingProfile: str | None = Field(default=None, max_length=40)
    detectorP50Ms: float | None = Field(default=None, ge=0)
    detectorP95Ms: float | None = Field(default=None, ge=0)
    processingFrameAgeMs: float | None = Field(default=None, ge=0)
    processingFramesSkipped: int = Field(default=0, ge=0)
    modelReady: bool = False
    reidReady: bool = False
    qualityReidReady: bool = False
    reidQueueDepth: int = Field(default=0, ge=0)
    qualityReidQueueDepth: int = Field(default=0, ge=0)


class DesktopTelemetryIngest(BaseModel):
    deviceId: str | None = Field(default=None, max_length=120)
    capturedAt: datetime | None = None
    metrics: DesktopMetricsSummary
    session: DesktopSessionSummary = Field(default_factory=DesktopSessionSummary)
    health: DesktopHealthSummary = Field(default_factory=DesktopHealthSummary)
    sourceKind: SourceKind = "real"
    mockRunId: str | None = Field(default=None, max_length=36)
    payload: dict | None = None


class TelemetrySnapshotSummary(BaseModel):
    id: str
    enterpriseId: str
    enterpriseName: str
    category: str | None = None
    barangay: str | None = None
    cameraId: str | None = None
    cameraName: str | None = None
    capturedAt: datetime
    receivedAt: datetime
    entries: int
    exits: int
    currentOccupancy: int
    peakOccupancy: int
    uniqueCount: int
    confirmedUniqueCount: int
    degradedUniqueCount: int
    totalEvents: int
    unsubmittedEvents: int
    unsyncedEvents: int
    running: bool
    status: str
    error: str | None = None
    analyticsFps: float | None = None
    gatewayStatus: str


class OperationalSummary(BaseModel):
    enterpriseCount: int
    onlineGateways: int
    delayedGateways: int
    offlineGateways: int
    totalCurrentOccupancy: int
    totalEntries: int
    totalExits: int
    totalUniqueCount: int
    activeReports: int
    pendingReports: int
    lastSyncAt: datetime | None = None


class DesktopReportSubmissionIngest(BaseModel):
    reportId: str = Field(min_length=3, max_length=80)
    period: str = Field(default="Current Period", min_length=1, max_length=120)
    submittedAt: datetime
    entries: int = Field(default=0, ge=0)
    exits: int = Field(default=0, ge=0)
    peakOccupancy: int = Field(default=0, ge=0)
    uniqueCount: int = Field(default=0, ge=0)
    notes: str | None = Field(default=None, max_length=5000)
    syncStatus: str | None = Field(default=None, max_length=60)
    sourceKind: SourceKind = "real"
    mockRunId: str | None = Field(default=None, max_length=36)
    payload: dict | None = None

    @model_validator(mode="after")
    def validate_report_metrics(self) -> DesktopReportSubmissionIngest:
        if self.exits > self.entries:
            raise ValueError("Total exits cannot exceed total entries.")
        if self.peakOccupancy > self.entries:
            raise ValueError("Peak occupancy cannot exceed total entries.")
        if self.uniqueCount > self.entries:
            raise ValueError("Estimated unique count cannot exceed total entries.")
        demo = (self.payload or {}).get("demo")
        required_demo_fields = {
            "thisProvMale",
            "thisProvFemale",
            "otherProvMale",
            "otherProvFemale",
            "foreignMale",
            "foreignFemale",
        }
        if not isinstance(demo, dict) or any(
            str(demo.get(field, "")).strip() == "" for field in required_demo_fields
        ):
            raise ValueError("All demographics fields are required.")
        if any(
            not str(demo[field]).strip().isdigit() or int(str(demo[field]).strip()) < 0
            for field in required_demo_fields
        ):
            raise ValueError("Demographics values must be non-negative whole numbers.")
        return self


class MockPreparationCounts(BaseModel):
    entries: int = Field(ge=0)
    exits: int = Field(ge=0)
    uniqueCount: int = Field(ge=0)
    peakOccupancy: int = Field(ge=0)
    period: str


class MockPreparationSummary(BaseModel):
    runId: str
    status: Literal["active", "removed"]
    enterpriseId: str
    enterpriseName: str
    counts: MockPreparationCounts | None = None


ReportReviewStatus = Literal["Pending Review", "Ready to Consolidate", "Returned", "Consolidated"]


class ReportStatusUpdate(BaseModel):
    status: ReportReviewStatus
    remarks: str | None = Field(default=None, max_length=2000)


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


FinalReportStatus = Literal["Draft", "Finalized", "Archived"]


class FinalReportSourceSummary(BaseModel):
    id: str
    enterprise: str
    code: str
    unique: int
    entry: int
    exit: int


class FinalReportSummary(BaseModel):
    id: str
    title: str
    period: str
    generatedOn: str
    preparedBy: str
    preparedRole: str
    status: FinalReportStatus
    totalEntry: int
    totalExit: int
    totalUnique: int
    enterpriseCount: int
    sources: list[FinalReportSourceSummary]


class OperationalAlertSummary(BaseModel):
    id: str
    type: Literal[
        "Maintenance Request",
        "Password Reset Request",
        "Submission Delay",
        "Threshold Breach",
        "Foot Traffic Alert",
        "Occupancy Spike",
    ]
    severity: Literal["Info", "Warning", "Critical"]
    enterprise: str | None = None
    requester: str
    summary: str
    requiredAction: str
    resolutionMode: Literal[
        "On-site Visit Required",
        "In-system Action",
        "Staff Follow-up",
        "Remote Review",
        "Admin Monitoring",
    ]
    status: Literal["New", "In Review", "Resolved"]
    owner: Literal["IT", "Admin", "System"]
    time: str


class OperationalAlertStatusUpdate(BaseModel):
    status: Literal["New", "In Review", "Resolved"]


class FinalReportCreate(BaseModel):
    reportIds: list[str] = Field(min_length=1, max_length=500)
    preparedBy: str = Field(min_length=1, max_length=120)


class FinalReportStatusUpdate(BaseModel):
    status: FinalReportStatus


class OperationalWebSocketEnvelope(BaseModel):
    type: Literal[
        "telemetry.snapshot",
        "report.submitted",
        "report.updated",
        "summary.updated",
        "final_report.generated",
        "final_report.updated",
    ]
    data: dict
