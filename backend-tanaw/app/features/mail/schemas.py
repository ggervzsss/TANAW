from datetime import datetime

from pydantic import BaseModel


class EmailDeliverySummary(BaseModel):
    id: str
    purpose: str
    recipient: str
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
