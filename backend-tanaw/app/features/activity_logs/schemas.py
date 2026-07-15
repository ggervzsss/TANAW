from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.pagination_schemas import CursorPageInfo

ActivityLogCategory = Literal[
    "IT Activity",
    "Staff Submission",
    "Staff Operation",
    "Admin Operation",
    "Enterprise Activity",
    "System",
]
ActivityLogSeverity = Literal["Info", "Warning", "Critical", "Success"]
ActivityLogActorRole = Literal["Admin", "IT Personnel", "LGU Staff", "Enterprise Account", "System"]


class ActivityLogSummary(BaseModel):
    id: str
    timestamp: datetime
    category: ActivityLogCategory
    severity: ActivityLogSeverity
    actor: str
    actorRole: ActivityLogActorRole
    action: str
    target: str
    summary: str
    sourceId: str | None = None
    metadata: dict[str, str | int | float | bool | None] | None = None


class ActivityLogPage(BaseModel):
    items: list[ActivityLogSummary]
    page: CursorPageInfo


class ActivityLogCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: ActivityLogCategory
    severity: ActivityLogSeverity = "Info"
    actor: str = Field(min_length=1, max_length=120)
    actorRole: ActivityLogActorRole
    action: str = Field(min_length=1, max_length=120)
    target: str = Field(min_length=1, max_length=255)
    summary: str = Field(min_length=1, max_length=1000)
    sourceId: str | None = Field(default=None, max_length=120)
    metadata: dict[str, str | int | float | bool | None] | None = None


class ActivityLogPurgeResponse(BaseModel):
    deletedCount: int
    retentionDays: int
