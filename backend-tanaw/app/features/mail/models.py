from datetime import datetime
from enum import StrEnum
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class EmailOutboxStatus(StrEnum):
    QUEUED = "queued"
    PROCESSING = "processing"
    RETRY_SCHEDULED = "retry_scheduled"
    ACCEPTED = "accepted"
    RECORDED = "recorded"
    TERMINAL_FAILED = "terminal_failed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"
    RECONCILIATION_REQUIRED = "reconciliation_required"


class EmailTemplateName(StrEnum):
    ACCOUNT_ACTIVATION = "account_activation"
    PASSWORD_RESET = "password_reset"
    BUSINESS_EMAIL_CHANGE = "business_email_change"
    SUPPORT_REPLY = "support_reply"


class EmailOutbox(Base):
    __tablename__ = "email_outbox"
    __table_args__ = (
        UniqueConstraint(
            "purpose",
            "source_id",
            "recipient",
            name="uq_email_outbox_logical_message",
        ),
        Index("ix_email_outbox_status_next_attempt", "status", "next_attempt_at"),
        Index("ix_email_outbox_purpose_source", "purpose", "source_id"),
        CheckConstraint("attempt_count >= 0", name="ck_email_outbox_attempt_count"),
        CheckConstraint("max_attempts >= 1", name="ck_email_outbox_max_attempts"),
        CheckConstraint("manual_retry_count >= 0", name="ck_email_outbox_manual_retry_count"),
        CheckConstraint(
            "(status = 'processing' AND lock_token IS NOT NULL AND lock_expires_at IS NOT NULL) "
            "OR (status <> 'processing' AND lock_token IS NULL AND lock_expires_at IS NULL)",
            name="ck_email_outbox_lease_state",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    account_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    purpose: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    source_id: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    recipient: Mapped[str] = mapped_column(String(255), nullable=False)
    sender: Mapped[str] = mapped_column(String(255), nullable=False)
    template_name: Mapped[str] = mapped_column(String(60), nullable=False)
    template_version: Mapped[str] = mapped_column(String(20), nullable=False, default="v1")
    secret_version: Mapped[str] = mapped_column(String(20), nullable=False, default="v1")
    template_payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    tags_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(
        String(256), unique=True, index=True, nullable=False
    )
    provider: Mapped[str] = mapped_column(String(40), nullable=False, default="resend")
    status: Mapped[str] = mapped_column(
        String(30), index=True, nullable=False, default=EmailOutboxStatus.QUEUED.value
    )
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    next_attempt_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lock_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    lock_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True, nullable=True
    )
    provider_message_id: Mapped[str | None] = mapped_column(
        String(120), unique=True, index=True, nullable=True
    )
    provider_payload_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    first_provider_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_provider_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    outcome_uncertain: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    manual_retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class EmailDeliveryAttempt(Base):
    __tablename__ = "email_delivery_attempts"
    __table_args__ = (
        UniqueConstraint("outbox_id", "attempt_number", name="uq_email_delivery_attempt"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    outbox_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("email_outbox.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    status: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    provider_message_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    outcome_uncertain: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
