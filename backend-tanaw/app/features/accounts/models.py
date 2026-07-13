from datetime import datetime
from enum import StrEnum
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class AccountRole(StrEnum):
    IT = "it"
    ADMIN = "admin"
    STAFF = "staff"
    ENTERPRISE = "enterprise"


class AccountStatus(StrEnum):
    ACTIVE = "active"
    INACTIVE = "inactive"


class AccountEmailChangeStatus(StrEnum):
    PENDING_VERIFICATION = "pending_verification"
    VERIFIED = "verified"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"
    REPLACED = "replaced"
    EXPIRED = "expired"


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    first_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    enterprise_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    category: Mapped[str | None] = mapped_column(String(120), nullable=True)
    manager_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    barangay: Mapped[str | None] = mapped_column(String(120), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    location_source: Mapped[str | None] = mapped_column(String(40), nullable=True)
    location_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    geocoded_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    location_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    enterprise_id: Mapped[str | None] = mapped_column(
        String(120), unique=True, index=True, nullable=True
    )
    gateway_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    gateway_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    building_capacity: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[AccountRole] = mapped_column(
        Enum(AccountRole, name="account_role"), nullable=False
    )
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[AccountStatus] = mapped_column(
        Enum(AccountStatus, name="account_status"), nullable=False, default=AccountStatus.ACTIVE
    )
    is_protected_system_account: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    password_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    token_invalid_before: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    failed_login_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    preferences_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_kind: Mapped[str] = mapped_column(String(20), nullable=False, default="real")
    mock_run_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AccountEmailChangeRequest(Base):
    __tablename__ = "account_email_change_requests"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending_verification', 'verified', 'approved', 'rejected', "
            "'cancelled', 'replaced', 'expired')",
            name="ck_account_email_change_status",
        ),
        Index(
            "uq_account_email_change_active_account",
            "account_id",
            unique=True,
            postgresql_where=text("status IN ('pending_verification', 'verified')"),
            sqlite_where=text("status IN ('pending_verification', 'verified')"),
        ),
        Index(
            "uq_account_email_change_active_email",
            "requested_email",
            unique=True,
            postgresql_where=text("status IN ('pending_verification', 'verified')"),
            sqlite_where=text("status IN ('pending_verification', 'verified')"),
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("accounts.id", ondelete="CASCADE"), index=True, nullable=False
    )
    old_email: Mapped[str] = mapped_column(String(255), nullable=False)
    requested_email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    token_hash: Mapped[str | None] = mapped_column(
        String(64), unique=True, index=True, nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(30),
        index=True,
        nullable=False,
        default=AccountEmailChangeStatus.PENDING_VERIFICATION,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
    requested_by_account_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    requested_by_name: Mapped[str] = mapped_column(String(120), nullable=False)
    requested_by_role: Mapped[str] = mapped_column(String(40), nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by_account_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    resolved_by_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    invalidated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class DeliveryStatus(StrEnum):
    RECORDED = "recorded"
    SENT = "sent"
    ACCEPTED = "accepted"
    FAILED = "failed"


class DevDelivery(Base):
    __tablename__ = "dev_deliveries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    account_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    recipient: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False, default="local")
    provider_message_id: Mapped[str | None] = mapped_column(
        String(120), unique=True, index=True, nullable=True
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[DeliveryStatus] = mapped_column(
        Enum(DeliveryStatus, name="delivery_status"),
        nullable=False,
        default=DeliveryStatus.RECORDED,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SystemConfiguration(Base):
    __tablename__ = "system_configuration"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default="default")
    values_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    updated_by: Mapped[str | None] = mapped_column(String(120), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
