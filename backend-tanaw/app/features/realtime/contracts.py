from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

type JSONValue = None | bool | int | float | str | list[JSONValue] | dict[str, JSONValue]


class RealtimeEventType(StrEnum):
    SUPPORT_TICKET_CREATED = "support_ticket.created"
    SUPPORT_TICKET_UPDATED = "support_ticket.updated"
    SUPPORT_TICKET_MESSAGE_CREATED = "support_ticket.message.created"
    SUPPORT_TICKET_STATUS_CHANGED = "support_ticket.status.changed"
    NOTIFICATION_CREATED = "notification.created"
    NOTIFICATION_UPDATED = "notification.updated"
    ALERT_CREATED = "alert.created"
    ALERT_UPDATED = "alert.updated"
    ALERT_STATUS_CHANGED = "alert.status.changed"
    ALERT_RESOLVED = "alert.resolved"
    ALERT_REOPENED = "alert.reopened"
    ACCOUNT_REQUEST_CREATED = "account_request.created"
    ACCOUNT_REQUEST_UPDATED = "account_request.updated"
    ACCOUNT_REQUEST_APPROVED = "account_request.approved"
    ACCOUNT_REQUEST_DECLINED = "account_request.declined"
    ENTERPRISE_CREATED = "enterprise.created"
    ENTERPRISE_UPDATED = "enterprise.updated"
    USER_CREATED = "user.created"
    USER_UPDATED = "user.updated"
    USER_STATUS_CHANGED = "user.status.changed"
    ACTIVITY_CREATED = "activity.created"
    REPORT_CREATED = "report.created"
    REPORT_UPDATED = "report.updated"
    REPORT_PROCESSING = "report.processing"
    REPORT_FINALIZED = "report.finalized"
    REPORT_ARCHIVED = "report.archived"
    REPORT_FAILED = "report.failed"
    EMAIL_DELIVERY_UPDATED = "email_delivery.updated"
    DEV_LOG_CREATED = "dev_log.created"
    TELEMETRY_UPDATED = "telemetry.updated"
    SYSTEM_SETTING_UPDATED = "system_setting.updated"


class RealtimeScope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enterprise_id: str | None = None
    enterprise_account_id: str | None = None
    recipient_account_id: str | None = None
    ticket_id: str | None = None
    report_id: str | None = None


class RealtimeActor(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user_id: str | None = None
    role: str | None = None


class RealtimeEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int = Field(default=1, frozen=True)
    event_id: str
    event_type: RealtimeEventType
    occurred_at: datetime
    sequence: int = Field(ge=1)
    scope: RealtimeScope = Field(default_factory=RealtimeScope)
    actor: RealtimeActor | None = None
    payload: dict[str, JSONValue] = Field(default_factory=dict)


class RealtimeReady(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = "realtime.ready"
    schema_version: int = 1
    latest_sequence: int = Field(ge=0)
    heartbeat_seconds: int = Field(ge=5)


class RealtimeHeartbeat(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = "realtime.heartbeat"
    occurred_at: datetime
