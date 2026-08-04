from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:
    from app.features.accounts.models import EnterpriseProfile


class EnterpriseReportSubmission(Base):
    __tablename__ = "enterprise_report_submissions"
    __table_args__ = (
        UniqueConstraint(
            "enterprise_profile_id",
            "report_id",
            name="uq_enterprise_report_submission",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    report_id: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    enterprise_profile_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(
            "enterprise_profiles.account_id",
            name="fk_enterprise_report_submissions_enterprise_profile_id",
            ondelete="RESTRICT",
        ),
        index=True,
        nullable=False,
    )
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
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    enterprise_profile: Mapped[EnterpriseProfile] = relationship(lazy="joined")


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
        String(36),
        ForeignKey(
            "final_reports.id",
            name="fk_final_report_sources_final_report_id",
            ondelete="CASCADE",
        ),
        index=True,
        nullable=False,
    )
    intake_report_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(
            "enterprise_report_submissions.id",
            name="fk_final_report_sources_intake_report_id",
            ondelete="RESTRICT",
        ),
        index=True,
        nullable=False,
    )
    enterprise: Mapped[str] = mapped_column(String(120), nullable=False)
    code: Mapped[str] = mapped_column(String(80), nullable=False)
    unique_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    entries: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    exits: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    intake_report: Mapped[EnterpriseReportSubmission] = relationship(lazy="joined")
