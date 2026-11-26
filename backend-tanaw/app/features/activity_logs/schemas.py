from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# The groups Activity is filtered by, shared by the Admin and IT views.
ActivityGroup = Literal[
    "Login & Security",
    "Accounts",
    "Enterprises",
    "Reports",
    "Requests",
    "Monitoring",
    "Settings & Maintenance",
]
ActivityLogSeverity = Literal["Info", "Warning", "Critical", "Success"]
ActivityLogActorRole = Literal["Admin", "IT Personnel", "LGU Staff", "Enterprise Account", "System"]


class ActivityLogTechnical(BaseModel):
    """Where an activity came from, recorded during the HTTP request. For IT only."""

    ipAddress: str | None = None
    userAgent: str | None = None
    sessionId: str | None = None
    """A short hash that tells sessions apart. Never the sign-in token itself."""


class ActivityLogSummary(BaseModel):
    id: str
    timestamp: datetime
    group: ActivityGroup
    severity: ActivityLogSeverity
    actor: str
    actorRole: ActivityLogActorRole
    action: str
    target: str
    summary: str
    """The plain sentence every reader sees."""
    itDetail: str | None = None
    """Technical details for IT, such as the camera or the error. Left out for the Admin."""
    sourceId: str | None = None
    metadata: dict[str, str | int | float | bool | None] | None = None
    technical: ActivityLogTechnical | None = None
    """The IP address, browser and session of the request. Left out for the Admin."""


class ActivityLogCreate(BaseModel):
    group: ActivityGroup
    severity: ActivityLogSeverity = "Info"
    actor: str = Field(min_length=1, max_length=120)
    actorRole: ActivityLogActorRole
    action: str = Field(min_length=1, max_length=120)
    target: str = Field(min_length=1, max_length=255)
    summary: str = Field(min_length=1, max_length=1000)
    itDetail: str | None = Field(default=None, max_length=2000)
    sourceId: str | None = Field(default=None, max_length=120)
    metadata: dict[str, str | int | float | bool | None] | None = None


class ActivityLogPurgeResponse(BaseModel):
    deletedCount: int
    retentionDays: int


class ActivityLogCleanupStatus(BaseModel):
    """When old activity was last removed, by IT or by the scheduled cleanup."""

    lastRunAt: datetime | None = None
    deletedCount: int | None = None
    retentionDays: int
