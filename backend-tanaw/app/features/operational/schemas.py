from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

SourceKind = Literal["real", "mock", "hybrid"]
FleetSimulationLane = Literal["normal", "warning", "one-minute-breach"]


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
    sourceKind: SourceKind = "real"
    mockRunId: str | None = None


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
    pendingCounts: list[MockPreparationCounts] = Field(default_factory=list)


class FleetSimulationEnterpriseSummary(BaseModel):
    enterpriseId: str
    enterpriseName: str
    category: str | None = None
    barangay: str | None = None
    isCurrent: bool = False


class FleetSimulationTarget(BaseModel):
    enterpriseId: str = Field(min_length=1, max_length=120)
    lane: FleetSimulationLane
    capacity: int = Field(default=100, ge=1, le=100_000)
    thresholdPercent: int = Field(default=90, ge=1, le=100)


class FleetSimulationTickIngest(BaseModel):
    runId: str = Field(min_length=3, max_length=36)
    startedAt: datetime
    elapsedSeconds: int = Field(ge=0, le=86_400)
    targets: list[FleetSimulationTarget] = Field(min_length=1, max_length=50)


class FleetSimulationTickSummary(BaseModel):
    runId: str
    snapshots: list[TelemetrySnapshotSummary]
    alerts: list[OperationalAlertSummary]


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
    payload: dict | None = None


FinalReportArchivedFromStatus = Literal["Draft", "Finalized"]
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
    archivedFromStatus: FinalReportArchivedFromStatus | None = None
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
        "Failed Login Threshold",
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


NotificationSeverity = Literal["Info", "Warning", "Critical", "Success"]


class UserNotificationSummary(BaseModel):
    id: str
    recipientAccountId: str
    title: str
    message: str
    type: str
    severity: NotificationSeverity
    sourceType: str | None = None
    sourceId: str | None = None
    createdBy: str | None = None
    recipientRole: str
    recipientEnterpriseId: str | None = None
    createdAt: str
    readAt: str | None = None


class EnterpriseNotificationCreate(BaseModel):
    enterpriseId: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=160)
    message: str = Field(min_length=1, max_length=2000)
    type: str = Field(default="Staff Follow-up", min_length=1, max_length=60)
    severity: NotificationSeverity = "Warning"
    sourceType: str | None = Field(default=None, max_length=80)
    sourceId: str | None = Field(default=None, max_length=120)


class NotificationReadUpdate(BaseModel):
    read: bool = True


SupportTicketCategory = Literal[
    "Camera Issue",
    "Report Concern",
    "Maintenance",
    "Account & Security",
    "Other",
]
SupportTicketPriority = Literal["Low", "Normal", "High", "Urgent"]
SupportTicketStatus = Literal["Open", "In Review", "Resolved"]
SupportTicketAttachmentType = Literal["image/png", "image/jpeg", "image/webp"]


class SupportTicketAttachment(BaseModel):
    id: str | None = None
    fileName: str = Field(min_length=1, max_length=160)
    mediaType: SupportTicketAttachmentType
    sizeBytes: int = Field(ge=1, le=5 * 1024 * 1024)
    dataUrl: str = Field(min_length=1, max_length=7_200_000)
    url: str | None = None

    @field_validator("fileName")
    @classmethod
    def validate_file_name(cls, value: str) -> str:
        file_name = value.strip().replace("\\", "/").split("/")[-1]
        if not file_name:
            raise ValueError("Photo file name is required.")
        lowered = file_name.lower()
        if not lowered.endswith((".png", ".jpg", ".jpeg", ".webp")):
            raise ValueError("Only image files are allowed.")
        return file_name

    @field_validator("dataUrl")
    @classmethod
    def validate_data_url(cls, value: str) -> str:
        if not value.startswith("data:image/"):
            raise ValueError("Only image files are allowed.")
        if ";base64," not in value:
            raise ValueError("Upload a valid image file.")
        return value

    @model_validator(mode="after")
    def validate_media_type_matches_data(self) -> SupportTicketAttachment:
        expected_prefix = f"data:{self.mediaType};base64,"
        if not self.dataUrl.startswith(expected_prefix):
            raise ValueError("Upload a valid image file.")
        return self


class SupportTicketCreate(BaseModel):
    category: SupportTicketCategory
    priority: SupportTicketPriority = "Normal"
    subject: str = Field(min_length=3, max_length=160)
    description: str = Field(min_length=10, max_length=4000)
    affectedArea: str | None = Field(default=None, max_length=120)
    cameraNode: str | None = Field(default=None, max_length=120)
    attachments: list[SupportTicketAttachment] = Field(default_factory=list, max_length=5)

    @field_validator("subject", "description", "affectedArea", "cameraNode", mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = " ".join(value.strip().split())
        return normalized or None


class SupportTicketSummary(BaseModel):
    id: str
    code: str
    enterpriseId: str
    enterpriseName: str
    submittedBy: str
    category: str
    priority: str
    subject: str
    description: str
    affectedArea: str | None = None
    cameraNode: str | None = None
    attachments: list[SupportTicketAttachment] = Field(default_factory=list)
    status: SupportTicketStatus
    createdAt: datetime
    updatedAt: datetime


class SupportTicketMessageCreate(BaseModel):
    message: str = Field(min_length=1, max_length=2000)

    @field_validator("message", mode="before")
    @classmethod
    def normalize_message(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = " ".join(value.strip().split())
        return normalized


class SupportTicketMessageSummary(BaseModel):
    id: str
    ticketId: str
    authorId: str
    authorName: str
    authorRole: str
    message: str
    createdAt: datetime


class SupportTicketStatusUpdate(BaseModel):
    status: SupportTicketStatus


class SupportTicketDetail(SupportTicketSummary):
    messages: list[SupportTicketMessageSummary] = Field(default_factory=list)


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
        "alert.created",
        "alert.updated",
        "alert.resolved",
        "notification.created",
        "notification.updated",
    ]
    data: dict
