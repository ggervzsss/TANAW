from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class UserNotification(Base):
    __tablename__ = "user_notifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    recipient_account_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(
            "accounts.id", name="fk_user_notifications_recipient_account_id", ondelete="CASCADE"
        ),
        index=True,
        nullable=False,
    )
    recipient_role: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    notification_type: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), index=True, nullable=False, default="Info")
    source_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    created_by_account_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey(
            "accounts.id",
            name="fk_user_notifications_created_by_account_id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )
    created_by_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
