from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Index,
    Sequence,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:
    from app.features.accounts.models import EnterpriseProfile


REQUEST_CODE_SEQUENCE = Sequence("request_code_sequence", start=1, metadata=Base.metadata)


class Request(Base):
    """Something a person asked for: help from IT, or IT's approval of an account change."""

    __tablename__ = "requests"
    __table_args__ = (
        Index(
            "uq_requests_open_account_change",
            "enterprise_profile_id",
            "change_field",
            unique=True,
            postgresql_where=text("change_field IS NOT NULL AND status = 'In Progress'"),
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    request_code: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    request_group: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), index=True, nullable=False, default="In Progress"
    )
    enterprise_profile_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey(
            "enterprise_profiles.account_id",
            name="fk_requests_enterprise_profile_id",
            ondelete="CASCADE",
        ),
        index=True,
        nullable=True,
    )
    enterprise_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    requester_name: Mapped[str] = mapped_column(String(120), nullable=False)
    requester_email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    affected_area: Mapped[str | None] = mapped_column(String(120), nullable=True)
    camera: Mapped[str | None] = mapped_column(String(120), nullable=True)
    attachments_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    change_field: Mapped[str | None] = mapped_column(String(40), nullable=True)
    change_value: Mapped[str | None] = mapped_column(String(255), nullable=True)
    email_change_request_id: Mapped[str | None] = mapped_column(
        String(64),
        ForeignKey(
            "account_email_change_requests.id",
            name="fk_requests_email_change_request_id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The IT person handling the request. An open request with no one here is not picked up.
    handled_by_account_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey(
            "accounts.id",
            name="fk_requests_handled_by_account_id",
            ondelete="SET NULL",
        ),
        nullable=True,
    )
    handled_by_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    enterprise_profile: Mapped[EnterpriseProfile | None] = relationship(lazy="joined")


class RequestMessage(Base):
    """A reply, an Admin note for IT, or a status change on a request's timeline."""

    __tablename__ = "request_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    request_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(
            "requests.id",
            name="fk_request_messages_request_id",
            ondelete="CASCADE",
        ),
        index=True,
        nullable=False,
    )
    author_account_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(
            "accounts.id",
            name="fk_request_messages_author_account_id",
            ondelete="RESTRICT",
        ),
        index=True,
        nullable=False,
    )
    author_name: Mapped[str] = mapped_column(String(120), nullable=False)
    author_role: Mapped[str] = mapped_column(String(40), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False, default="message")
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )


class RequestRead(Base):
    """When an account last read a request, for its New and Updated marks."""

    __tablename__ = "request_reads"

    account_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("accounts.id", name="fk_request_reads_account_id", ondelete="CASCADE"),
        primary_key=True,
    )
    request_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("requests.id", name="fk_request_reads_request_id", ondelete="CASCADE"),
        primary_key=True,
    )
    read_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
