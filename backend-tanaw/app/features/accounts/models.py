from datetime import datetime
from enum import StrEnum
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Uuid,
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

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    first_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
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
        Uuid(as_uuid=False),
        ForeignKey("accounts.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
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
    requested_by_account_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=True
    )
    requested_by_name: Mapped[str] = mapped_column(String(120), nullable=False)
    requested_by_role: Mapped[str] = mapped_column(String(40), nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by_account_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=True
    )
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


class SystemSetting(Base):
    """The bounded, typed singleton of runtime-editable TANAW policy."""

    __tablename__ = "system_settings"
    __table_args__ = (
        CheckConstraint("id = 'default'", name="ck_system_settings_singleton"),
        CheckConstraint(
            "login_attempt_limit IN (3, 5, 10)", name="ck_system_settings_login_attempt_limit"
        ),
        CheckConstraint(
            "login_lock_minutes IN (5, 15, 30, 60)",
            name="ck_system_settings_login_lock_minutes",
        ),
        CheckConstraint(
            "log_retention_days IN (90, 180, 365)",
            name="ck_system_settings_log_retention_days",
        ),
    )

    id: Mapped[str] = mapped_column(String(20), primary_key=True, default="default")
    login_attempt_limit: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    login_lock_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    log_retention_days: Mapped[int] = mapped_column(Integer, nullable=False, default=180)
    camera_session_error_alerts: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    gateway_service_error_alerts: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True
    )
    sync_delay_alerts: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    failed_login_lockout_alerts: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    updated_by_account_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=True
    )
    updated_by_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class SeedState(Base):
    """One-time startup seed completion, isolated from mutable runtime settings."""

    __tablename__ = "seed_states"

    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    initialized_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    account_count: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
