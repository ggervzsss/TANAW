from typing import Literal

from pydantic import BaseModel, Field

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
