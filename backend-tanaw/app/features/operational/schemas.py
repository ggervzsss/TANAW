from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.features.reporting.contracts import reporting_period_from_key


class MockPreparationSourceWindow(BaseModel):
    start: datetime
    end: datetime


class MockPreparationCounts(BaseModel):
    entries: int = Field(ge=0)
    exits: int = Field(ge=0)
    uniqueCount: int = Field(ge=0)
    peakOccupancy: int = Field(ge=0)
    period: str
    periodKey: str
    sourceWindow: MockPreparationSourceWindow

    @model_validator(mode="after")
    def validate_canonical_period(self) -> MockPreparationCounts:
        reporting_period = reporting_period_from_key(self.periodKey)
        if (
            self.sourceWindow.start.tzinfo is None
            or self.sourceWindow.start.utcoffset() is None
            or self.sourceWindow.end.tzinfo is None
            or self.sourceWindow.end.utcoffset() is None
        ):
            raise ValueError("Mock preparation source-window bounds must include a UTC offset.")
        if (
            self.sourceWindow.start.astimezone(UTC) != reporting_period.starts_at
            or self.sourceWindow.end.astimezone(UTC) != reporting_period.ends_at
        ):
            raise ValueError(
                "Mock preparation source window must match the canonical reporting period."
            )
        return self


class MockPreparationSummary(BaseModel):
    runId: str
    status: Literal["active", "removed"]
    enterpriseId: str
    enterpriseName: str
    counts: MockPreparationCounts | None = None
    pendingCounts: list[MockPreparationCounts] = Field(default_factory=list)


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
        "Sync Delay",
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
        "Automatic Health Recovery",
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
    targetPath: str | None = None
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
    id: str
    fileName: str = Field(min_length=1, max_length=160)
    mediaType: SupportTicketAttachmentType
    sizeBytes: int = Field(ge=1, le=5 * 1024 * 1024)
    url: str

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


class SupportTicketCreate(BaseModel):
    category: SupportTicketCategory
    priority: SupportTicketPriority = "Normal"
    subject: str = Field(min_length=3, max_length=160)
    description: str = Field(min_length=10, max_length=4000)
    affectedArea: str | None = Field(default=None, max_length=120)
    cameraNode: str | None = Field(default=None, max_length=120)

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


class OperationalWebSocketEnvelope(BaseModel):
    type: Literal["resource.invalidated"]
    data: dict
