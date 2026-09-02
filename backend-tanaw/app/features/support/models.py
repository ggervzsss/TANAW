from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Sequence, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:
    from app.features.accounts.models import EnterpriseProfile


SUPPORT_TICKET_CODE_SEQUENCE = Sequence(
    "support_ticket_code_sequence", start=1, metadata=Base.metadata
)


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    ticket_code: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    enterprise_profile_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(
            "enterprise_profiles.account_id",
            name="fk_support_tickets_enterprise_profile_id",
            ondelete="RESTRICT",
        ),
        index=True,
        nullable=False,
    )
    enterprise_name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    priority: Mapped[str] = mapped_column(String(20), index=True, nullable=False, default="Normal")
    subject: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    affected_area: Mapped[str | None] = mapped_column(String(120), nullable=True)
    camera_node: Mapped[str | None] = mapped_column(String(120), nullable=True)
    attachments_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(30), index=True, nullable=False, default="Open")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    enterprise_profile: Mapped[EnterpriseProfile] = relationship(lazy="joined")


class SupportTicketMessage(Base):
    __tablename__ = "support_ticket_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    ticket_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(
            "support_tickets.id",
            name="fk_support_ticket_messages_ticket_id",
            ondelete="CASCADE",
        ),
        index=True,
        nullable=False,
    )
    author_account_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(
            "accounts.id",
            name="fk_support_ticket_messages_author_account_id",
            ondelete="RESTRICT",
        ),
        index=True,
        nullable=False,
    )
    author_name: Mapped[str] = mapped_column(String(120), nullable=False)
    author_role: Mapped[str] = mapped_column(String(40), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
