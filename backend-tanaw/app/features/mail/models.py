from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class InboundEmailReceipt(Base):
    __tablename__ = "inbound_email_receipts"

    provider_email_id: Mapped[str] = mapped_column(String(120), primary_key=True)
    webhook_event_id: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    message_id: Mapped[str | None] = mapped_column(String(500), index=True, nullable=True)
    sender_email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    ticket_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    disposition: Mapped[str] = mapped_column(String(40), nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
