from datetime import datetime

from pydantic import BaseModel


class DevDeliverySummary(BaseModel):
    id: str
    accountId: str
    recipient: str
    subject: str
    body: str
    status: str
    createdAt: datetime
    actionLink: str | None = None
    actionLabel: str | None = None
