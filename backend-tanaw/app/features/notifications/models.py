from datetime import datetime
from uuid import uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class UserNotification(Base):
    __tablename__ = "user_notifications"
    __table_args__ = (
        CheckConstraint(
            "recipient_role IN ('it', 'admin', 'staff', 'enterprise')",
            name="ck_user_notifications_recipient_role",
        ),
        CheckConstraint(
            "severity IN ('Info', 'Warning', 'Critical', 'Success')",
            name="ck_user_notifications_severity",
        ),
        CheckConstraint(
            "(recipient_role = 'enterprise' AND recipient_enterprise_id IS NOT NULL) OR "
            "(recipient_role != 'enterprise' AND recipient_enterprise_id IS NULL)",
            name="ck_user_notifications_enterprise_scope",
        ),
        CheckConstraint(
            "(created_by_account_id IS NULL AND created_by_name IS NULL) OR "
            "(created_by_account_id IS NOT NULL AND created_by_name IS NOT NULL "
            "AND length(trim(created_by_name)) > 0)",
            name="ck_user_notifications_actor_snapshot",
        ),
        Index(
            "ix_user_notifications_read_retention",
            "read_at",
            "id",
            postgresql_where=text("read_at IS NOT NULL"),
            sqlite_where=text("read_at IS NOT NULL"),
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    recipient_account_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("accounts.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    recipient_role: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    recipient_enterprise_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("enterprises.id", ondelete="RESTRICT"),
        index=True,
        nullable=True,
    )
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    notification_type: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), index=True, nullable=False, default="Info")
    source_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    created_by_account_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=True
    )
    created_by_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
