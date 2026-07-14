from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class EnterpriseTelemetrySnapshot(Base):
    __tablename__ = "enterprise_telemetry_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    enterprise_account_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    enterprise_id: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    enterprise_name: Mapped[str] = mapped_column(String(120), nullable=False)
    camera_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    camera_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    entries: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    exits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    current_occupancy: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    peak_occupancy: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unique_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    confirmed_unique_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    degraded_unique_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_events: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unsubmitted_events: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unsynced_events: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    running: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="unknown")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    analytics_fps: Mapped[float | None] = mapped_column(Float, nullable=True)
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_kind: Mapped[str] = mapped_column(String(20), nullable=False, default="real")
    mock_run_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)


class EnterpriseReportSubmission(Base):
    __tablename__ = "enterprise_report_submissions"
    __table_args__ = (
        UniqueConstraint("enterprise_id", "report_id", name="uq_enterprise_report_submission"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    report_id: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    enterprise_account_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    enterprise_id: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    enterprise_name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str | None] = mapped_column(String(120), nullable=True)
    barangay: Mapped[str | None] = mapped_column(String(120), nullable=True)
    period: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    month: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    entries: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    exits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    peak_occupancy: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    unique_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="Submitted")
    review_status: Mapped[str] = mapped_column(String(40), nullable=False, default="Pending Review")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    sync_status: Mapped[str | None] = mapped_column(String(60), nullable=True)
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_kind: Mapped[str] = mapped_column(String(20), nullable=False, default="real")
    mock_run_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class FinalReport(Base):
    __tablename__ = "final_reports"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    report_code: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    period: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    generated_on: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    prepared_by: Mapped[str] = mapped_column(String(120), nullable=False)
    prepared_role: Mapped[str] = mapped_column(
        String(120), nullable=False, default="Staff Processing Division"
    )
    status: Mapped[str] = mapped_column(String(40), nullable=False, default="Draft")
    archived_from_status: Mapped[str | None] = mapped_column(String(40), nullable=True)
    total_entry: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_exit: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_unique: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    enterprise_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    source_kind: Mapped[str] = mapped_column(String(20), nullable=False, default="real")
    mock_run_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class FinalReportSource(Base):
    __tablename__ = "final_report_sources"
    __table_args__ = (
        UniqueConstraint("final_report_id", "intake_report_id", name="uq_final_report_source"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    final_report_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("final_reports.id", ondelete="CASCADE"), index=True, nullable=False
    )
    intake_report_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    enterprise_id: Mapped[str] = mapped_column(String(120), index=True, nullable=False)
    enterprise: Mapped[str] = mapped_column(String(120), nullable=False)
    code: Mapped[str] = mapped_column(String(80), nullable=False)
    unique_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    entries: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    exits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class MockDataRun(Base):
    __tablename__ = "mock_data_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    scenario: Mapped[str] = mapped_column(String(80), nullable=False)
    seed: Mapped[str] = mapped_column(String(80), nullable=False)
    range_start: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    range_end: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    target_account_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
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

    run_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("mock_data_runs.id", ondelete="CASCADE"), primary_key=True
    )
    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("accounts.id", ondelete="CASCADE"), primary_key=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class OperationalAlert(Base):
    __tablename__ = "operational_alerts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    recipient_account_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    recipient_role: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    recipient_enterprise_id: Mapped[str | None] = mapped_column(
        String(120), index=True, nullable=True
    )
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    notification_type: Mapped[str] = mapped_column(String(60), index=True, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), index=True, nullable=False, default="Info")
    source_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    created_by_account_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_by_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    ticket_code: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    enterprise_account_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    ticket_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("support_tickets.id", ondelete="CASCADE"), index=True, nullable=False
    )
    author_account_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    author_name: Mapped[str] = mapped_column(String(120), nullable=False)
    author_role: Mapped[str] = mapped_column(String(40), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
