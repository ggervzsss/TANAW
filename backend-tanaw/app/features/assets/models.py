"""Normalized account settings, workflow requests, and asset metadata."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class AccountPreference(Base):
    __tablename__ = "account_preferences"
    __table_args__ = (
        CheckConstraint(
            "theme IN ('light', 'dark', 'system')", name="ck_account_preferences_theme"
        ),
    )

    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True
    )
    theme: Mapped[str] = mapped_column(String(20), nullable=False, default="system")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class AccountProfileChangeRequest(Base):
    __tablename__ = "account_profile_change_requests"
    __table_args__ = (
        CheckConstraint(
            "request_type IN ('contact_number')",
            name="ck_account_profile_change_requests_type",
        ),
        CheckConstraint(
            "status IN ('pending_review', 'approved', 'rejected', 'cancelled')",
            name="ck_account_profile_change_requests_status",
        ),
        CheckConstraint(
            "(status = 'pending_review' AND resolved_at IS NULL "
            "AND resolved_by_account_id IS NULL) OR "
            "(status != 'pending_review' AND resolved_at IS NOT NULL)",
            name="ck_account_profile_change_requests_resolution",
        ),
        Index(
            "uq_account_profile_change_requests_active",
            "account_id",
            "request_type",
            unique=True,
            postgresql_where=text("status = 'pending_review'"),
            sqlite_where=text("status = 'pending_review'"),
        ),
        Index(
            "ix_account_profile_change_requests_account_status",
            "account_id",
            "status",
            "requested_at",
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
    )
    request_type: Mapped[str] = mapped_column(String(30), nullable=False)
    requested_value: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending_review")
    requested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by_account_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=True
    )


class AccountAsset(Base):
    __tablename__ = "account_assets"
    __table_args__ = (
        CheckConstraint("asset_kind IN ('profile_image')", name="ck_account_assets_kind"),
        CheckConstraint("status IN ('active', 'deleted')", name="ck_account_assets_status"),
        CheckConstraint(
            "mime_type IN ('image/png', 'image/jpeg', 'image/webp')",
            name="ck_account_assets_mime_type",
        ),
        CheckConstraint("size_bytes BETWEEN 1 AND 5242880", name="ck_account_assets_size"),
        CheckConstraint(
            "length(content_hash) = 71 AND content_hash LIKE 'sha256:%'",
            name="ck_account_assets_content_hash",
        ),
        CheckConstraint(
            "(status = 'active' AND deleted_at IS NULL) OR "
            "(status = 'deleted' AND deleted_at IS NOT NULL)",
            name="ck_account_assets_deletion",
        ),
        UniqueConstraint("storage_key", name="uq_account_assets_storage_key"),
        Index(
            "uq_account_assets_active_kind",
            "account_id",
            "asset_kind",
            unique=True,
            postgresql_where=text("status = 'active'"),
            sqlite_where=text("status = 'active'"),
        ),
        Index("ix_account_assets_account_status", "account_id", "status", "created_at"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False
    )
    asset_kind: Mapped[str] = mapped_column(String(30), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    file_name: Mapped[str] = mapped_column(String(160), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(80), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SupportAttachment(Base):
    __tablename__ = "support_attachments"
    __table_args__ = (
        CheckConstraint("ordinal BETWEEN 0 AND 4", name="ck_support_attachments_ordinal"),
        CheckConstraint("status IN ('active', 'deleted')", name="ck_support_attachments_status"),
        CheckConstraint(
            "mime_type IN ('image/png', 'image/jpeg', 'image/webp')",
            name="ck_support_attachments_mime_type",
        ),
        CheckConstraint("size_bytes BETWEEN 1 AND 5242880", name="ck_support_attachments_size"),
        CheckConstraint(
            "length(content_hash) = 71 AND content_hash LIKE 'sha256:%'",
            name="ck_support_attachments_content_hash",
        ),
        CheckConstraint(
            "(status = 'active' AND deleted_at IS NULL) OR "
            "(status = 'deleted' AND deleted_at IS NOT NULL)",
            name="ck_support_attachments_deletion",
        ),
        CheckConstraint(
            "retention_expires_at IS NULL OR retention_expires_at > created_at",
            name="ck_support_attachments_retention",
        ),
        UniqueConstraint("storage_key", name="uq_support_attachments_storage_key"),
        Index(
            "uq_support_attachments_active_ordinal",
            "ticket_id",
            "ordinal",
            unique=True,
            postgresql_where=text("status = 'active'"),
            sqlite_where=text("status = 'active'"),
        ),
        Index("ix_support_attachments_ticket_status", "ticket_id", "status", "ordinal"),
        Index("ix_support_attachments_retention", "retention_expires_at"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    ticket_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("support_tickets.id", ondelete="CASCADE"), nullable=False
    )
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    file_name: Mapped[str] = mapped_column(String(160), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(80), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(71), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    retention_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
