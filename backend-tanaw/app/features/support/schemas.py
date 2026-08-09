from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

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
    affectedArea: str | None = Field(default=None, min_length=1, max_length=120)
    cameraNode: str | None = Field(default=None, max_length=120)
    attachments: list[SupportTicketAttachment] = Field(default_factory=list, max_length=5)

    @field_validator("subject", "description", "affectedArea", "cameraNode", mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = " ".join(value.strip().split())
        return normalized or None

    @model_validator(mode="after")
    def validate_category_fields(self) -> SupportTicketCreate:
        field_policy = {
            "Camera Issue": (True, True),
            "Report Concern": (False, False),
            "Maintenance": (True, True),
            "Account & Security": (False, False),
            "Other": (True, False),
        }
        requires_affected_area, accepts_camera = field_policy[self.category]
        if requires_affected_area and not self.affectedArea:
            raise ValueError("Affected area is required for this ticket category.")
        if not requires_affected_area:
            self.affectedArea = None
        if not accepts_camera:
            self.cameraNode = None
        return self


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
