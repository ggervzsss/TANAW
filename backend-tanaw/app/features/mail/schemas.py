from datetime import datetime

from pydantic import BaseModel


class EmailDeliverySummary(BaseModel):
    id: str
    purpose: str
    recipient: str
    accountId: str | None = None
    recipientName: str | None = None
    """The account's display name, or the enterprise name for an enterprise account."""
    recipientRole: str | None = None
    """Admin, IT Personnel, LGU Staff or Enterprise Account."""
    provider: str
    status: str
    attemptCount: int
    maxAttempts: int
    manualRetryCount: int
    nextAttemptAt: datetime | None
    providerMessageId: str | None
    errorCode: str | None
    failureReason: str | None
    outcomeUncertain: bool
    canRetry: bool
    createdAt: datetime
    acceptedAt: datetime | None
