import base64
import binascii
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

RequestGroup = Literal[
    "Sign-in help",
    "Desktop app or camera problem",
    "Report problem",
    "Account change",
    "Other",
]
# The groups an enterprise picks from; Sign-in help and Account change are set by TANAW.
SenderRequestGroup = Literal["Desktop app or camera problem", "Report problem", "Other"]
RequestStatus = Literal["Sent", "In Progress", "Resolved", "Approved", "Declined"]
AccountChangeField = Literal["businessEmail", "contactNumber", "enterpriseName"]
AccountChangeVerification = Literal["pending_verification", "verified", "expired"]
RequestMessageKind = Literal["message", "note", "status"]
RequestAttachmentType = Literal["image/png", "image/jpeg", "image/webp"]
MAX_REQUEST_ATTACHMENT_BYTES = 5 * 1024 * 1024
MAX_REQUEST_ATTACHMENT_DATA_URL_LENGTH = 7_200_000


def _normalize_text(value: object) -> object:
    if not isinstance(value, str):
        return value
    normalized = " ".join(value.strip().split())
    return normalized or None


class RequestAttachmentCreate(BaseModel):
    fileName: str = Field(min_length=1, max_length=160)
    mediaType: RequestAttachmentType
    sizeBytes: int = Field(ge=1, le=MAX_REQUEST_ATTACHMENT_BYTES)
    dataUrl: str = Field(
        min_length=1,
        max_length=MAX_REQUEST_ATTACHMENT_DATA_URL_LENGTH,
    )

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
    def validate_attachment_data(self) -> RequestAttachmentCreate:
        expected_prefix = f"data:{self.mediaType};base64,"
        if not self.dataUrl.startswith(expected_prefix):
            raise ValueError("Upload a valid image file.")
        try:
            decoded = base64.b64decode(
                self.dataUrl.removeprefix(expected_prefix),
                validate=True,
            )
        except (binascii.Error, ValueError) as exc:
            raise ValueError("Upload a valid image file.") from exc
        if not decoded or len(decoded) > MAX_REQUEST_ATTACHMENT_BYTES:
            raise ValueError("Each photo must be under 5 MB.")
        if len(decoded) != self.sizeBytes:
            raise ValueError("Photo size does not match the uploaded content.")
        return self


class RequestAttachmentMetadata(BaseModel):
    id: str
    fileName: str
    mediaType: RequestAttachmentType
    sizeBytes: int
    url: str


class RequestCreate(BaseModel):
    group: SenderRequestGroup
    title: str = Field(min_length=3, max_length=160)
    description: str = Field(min_length=10, max_length=4000)
    affectedArea: str | None = Field(default=None, min_length=1, max_length=120)
    camera: str | None = Field(default=None, max_length=120)
    attachments: list[RequestAttachmentCreate] = Field(default_factory=list, max_length=5)

    @field_validator("title", "description", "affectedArea", "camera", mode="before")
    @classmethod
    def normalize_text(cls, value: object) -> object:
        return _normalize_text(value)

    @model_validator(mode="after")
    def keep_camera_fields_for_camera_problems(self) -> RequestCreate:
        if self.group != "Desktop app or camera problem":
            self.camera = None
        return self


class SignInHelpCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: EmailStr
    message: str = Field(min_length=10, max_length=4000)


class AccountChangeSummary(BaseModel):
    field: AccountChangeField
    label: str
    currentValue: str | None = None
    requestedValue: str
    verification: AccountChangeVerification | None = None
    """Only for a business email: whether the new address has been verified."""
    canApprove: bool


class RequestSummary(BaseModel):
    id: str
    code: str
    group: RequestGroup
    title: str
    description: str
    status: RequestStatus
    urgent: bool
    enterpriseId: str | None = None
    enterpriseName: str | None = None
    requesterName: str
    requesterEmail: str | None = None
    affectedArea: str | None = None
    camera: str | None = None
    attachments: list[RequestAttachmentMetadata] = Field(default_factory=list)
    accountChange: AccountChangeSummary | None = None
    createdAt: datetime
    updatedAt: datetime
    closedAt: datetime | None = None
    unread: bool = False
    """The reader has never opened this request."""
    updated: bool = False
    """The request changed since the reader last opened it."""


class RequestMessageCreate(BaseModel):
    message: str = Field(min_length=1, max_length=2000)

    @field_validator("message", mode="before")
    @classmethod
    def normalize_message(cls, value: object) -> object:
        normalized = _normalize_text(value)
        return "" if normalized is None else normalized


class RequestMessageSummary(BaseModel):
    id: str
    requestId: str
    authorId: str
    authorName: str
    authorRole: str
    kind: RequestMessageKind
    message: str
    createdAt: datetime


class RequestDetail(RequestSummary):
    messages: list[RequestMessageSummary] = Field(default_factory=list)


class RequestStatusUpdate(BaseModel):
    status: RequestStatus


class RequestGroupUpdate(BaseModel):
    group: RequestGroup


class RequestUrgentUpdate(BaseModel):
    urgent: bool


class RequestReadUpdate(BaseModel):
    requestIds: list[str] = Field(default_factory=list, max_length=500)
    all: bool = False


class RequestReadResponse(BaseModel):
    readCount: int
