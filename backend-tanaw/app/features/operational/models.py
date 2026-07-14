from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class MockDataRun(Base):
    __tablename__ = "mock_data_runs"
    __table_args__ = (
        CheckConstraint("range_end > range_start", name="ck_mock_data_runs_range"),
        CheckConstraint("status IN ('active', 'removed')", name="ck_mock_data_runs_status"),
        CheckConstraint(
            "(status = 'active' AND ended_at IS NULL) OR "
            "(status = 'removed' AND ended_at IS NOT NULL)",
            name="ck_mock_data_runs_lifecycle",
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    scenario: Mapped[str] = mapped_column(String(80), nullable=False)
    seed: Mapped[str] = mapped_column(String(80), nullable=False)
    range_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    range_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    target_account_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True
    )
    target_enterprise_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    target_enterprise_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="active")
    generated_counts_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MockDataRunAccount(Base):
    __tablename__ = "mock_data_run_accounts"
    __table_args__ = (Index("ix_mock_data_run_accounts_account_id", "account_id"),)

    run_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("mock_data_runs.id", ondelete="CASCADE"), primary_key=True
    )
    account_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class OperationalAlert(Base):
    __tablename__ = "operational_alerts"
    __table_args__ = (
        CheckConstraint(
            "alert_type IN ('Maintenance Request', 'Password Reset Request', "
            "'Submission Delay', 'Threshold Breach', 'Foot Traffic Alert', "
            "'Occupancy Spike', 'Failed Login Threshold', 'Sync Delay')",
            name="ck_operational_alerts_type",
        ),
        CheckConstraint(
            "severity IN ('Info', 'Warning', 'Critical')",
            name="ck_operational_alerts_severity",
        ),
        CheckConstraint(
            "resolution_mode IN ('On-site Visit Required', 'In-system Action', "
            "'Staff Follow-up', 'Remote Review', 'Admin Monitoring', "
            "'Automatic Health Recovery')",
            name="ck_operational_alerts_resolution_mode",
        ),
        CheckConstraint(
            "status IN ('New', 'In Review', 'Resolved')",
            name="ck_operational_alerts_status",
        ),
        CheckConstraint(
            "owner IN ('IT', 'Admin', 'System')",
            name="ck_operational_alerts_owner",
        ),
        Index(
            "uq_operational_alerts_active_source",
            "alert_type",
            "source_id",
            unique=True,
            postgresql_where=text("source_id IS NOT NULL AND status != 'Resolved'"),
            sqlite_where=text("source_id IS NOT NULL AND status != 'Resolved'"),
        ),
        Index(
            "ix_operational_alerts_resolved_retention",
            "updated_at",
            "id",
            postgresql_where=text("status = 'Resolved'"),
            sqlite_where=text("status = 'Resolved'"),
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    alert_code: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    alert_type: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    enterprise: Mapped[str | None] = mapped_column(String(120), nullable=True)
    requester: Mapped[str] = mapped_column(String(120), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    required_action: Mapped[str] = mapped_column(Text, nullable=False)
    resolution_mode: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(20), index=True, nullable=False, default="New")
    owner: Mapped[str] = mapped_column(String(20), index=True, nullable=False, default="IT")
    source_id: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


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


class SupportTicket(Base):
    __tablename__ = "support_tickets"
    __table_args__ = (
        CheckConstraint(
            "category IN ('Camera Issue', 'Report Concern', 'Maintenance', "
            "'Account & Security', 'Other')",
            name="ck_support_tickets_category",
        ),
        CheckConstraint(
            "priority IN ('Low', 'Normal', 'High', 'Urgent')",
            name="ck_support_tickets_priority",
        ),
        CheckConstraint(
            "status IN ('Open', 'In Review', 'Resolved')",
            name="ck_support_tickets_status",
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    ticket_code: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    enterprise_account_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("accounts.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    enterprise_id: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    enterprise_name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    priority: Mapped[str] = mapped_column(String(20), index=True, nullable=False, default="Normal")
    subject: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    affected_area: Mapped[str | None] = mapped_column(String(120), nullable=True)
    camera_node: Mapped[str | None] = mapped_column(String(120), nullable=True)
    status: Mapped[str] = mapped_column(String(30), index=True, nullable=False, default="Open")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class SupportTicketMessage(Base):
    __tablename__ = "support_ticket_messages"
    __table_args__ = (
        CheckConstraint(
            "author_role IN ('it', 'admin', 'staff', 'enterprise')",
            name="ck_support_ticket_messages_author_role",
        ),
        CheckConstraint(
            "length(trim(author_name)) > 0 AND length(trim(message)) > 0",
            name="ck_support_ticket_messages_content",
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    ticket_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("support_tickets.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    author_account_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("accounts.id", ondelete="RESTRICT"),
        index=True,
        nullable=False,
    )
    author_name: Mapped[str] = mapped_column(String(120), nullable=False)
    author_role: Mapped[str] = mapped_column(String(40), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
