from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class PasswordResetChallenge(Base):
    __tablename__ = "password_reset_challenges"
    __table_args__ = (
        CheckConstraint("attempts >= 0", name="ck_password_reset_challenge_attempts"),
        CheckConstraint("reset_attempts >= 0", name="ck_password_reset_challenge_reset_attempts"),
        Index(
            "ix_password_reset_challenges_email_active_created",
            "email",
            "used",
            "created_at",
        ),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    account_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey(
            "accounts.id",
            name="fk_password_reset_challenges_account_id",
            ondelete="SET NULL",
        ),
        index=True,
        nullable=True,
    )
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    reset_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    code_consumed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    used: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reset_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    invalidated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), index=True, nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class PasswordResetRateLimitBucket(Base):
    __tablename__ = "password_reset_rate_limit_buckets"
    __table_args__ = (
        CheckConstraint("request_count >= 0", name="ck_password_reset_rate_count"),
        CheckConstraint(
            "scope IN ('global', 'ip', 'identifier')",
            name="ck_password_reset_rate_scope",
        ),
    )

    bucket_key: Mapped[str] = mapped_column(String(120), primary_key=True)
    scope: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    window_started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    request_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    blocked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), index=True
    )


class AccountActivationToken(Base):
    __tablename__ = "account_activation_tokens"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    account_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(
            "accounts.id", name="fk_account_activation_tokens_account_id", ondelete="CASCADE"
        ),
        index=True,
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    invalidated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
