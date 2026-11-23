from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.features.activity_logs.schemas import ActivityLogSummary

AdminRequestSourceType = Literal["operational.alert", "support.ticket", "enterprise.profile"]
MAX_ADMIN_REQUEST_MESSAGE_LENGTH = 1000


class AdminRequestMessageCreate(BaseModel):
    """A note from an Admin to IT about one request on the Admin Requests screen."""

    sourceType: AdminRequestSourceType
    sourceId: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=MAX_ADMIN_REQUEST_MESSAGE_LENGTH)

    @field_validator("sourceId", "message", mode="before")
    @classmethod
    def strip_text(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value


class AdminRequestMessageResult(BaseModel):
    """The activity record that keeps the message, and how many IT accounts were notified."""

    activity: ActivityLogSummary
    recipientCount: int
