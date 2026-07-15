from datetime import datetime
from uuid import uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, String, Text, Uuid, desc, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ActivityLog(Base):
    __tablename__ = "activity_logs"
    __table_args__ = (
        CheckConstraint(
            "classification IN ('official', 'simulation')",
            name="ck_activity_logs_classification",
        ),
        CheckConstraint(
            "category IN ('IT Activity', 'Staff Submission', 'Staff Operation', "
            "'Admin Operation', 'Enterprise Activity', 'System')",
            name="ck_activity_logs_category",
        ),
        CheckConstraint(
            "severity IN ('Info', 'Warning', 'Critical', 'Success')",
            name="ck_activity_logs_severity",
        ),
        CheckConstraint(
            "actor_role IN ('Admin', 'IT Personnel', 'LGU Staff', 'Enterprise Account', 'System')",
            name="ck_activity_logs_actor_role",
        ),
        CheckConstraint(
            "(classification = 'official' AND simulation_run_id IS NULL) OR "
            "(classification = 'simulation' AND simulation_run_id IS NOT NULL)",
            name="ck_activity_logs_simulation_scope",
        ),
        CheckConstraint(
            "length(trim(actor)) > 0 AND length(trim(action)) > 0 "
            "AND length(trim(target)) > 0 AND length(trim(summary)) > 0 "
            "AND length(summary) <= 1000",
            name="ck_activity_logs_required_text",
        ),
        CheckConstraint(
            "metadata_json IS NULL OR length(metadata_json) <= 20000",
            name="ck_activity_logs_metadata_size",
        ),
        Index("ix_activity_logs_official_time", "classification", desc("timestamp"), "id"),
        Index("ix_activity_logs_simulation_run_id", "simulation_run_id"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    category: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), nullable=False)
    actor: Mapped[str] = mapped_column(String(120), nullable=False)
    actor_account_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("accounts.id", name="fk_activity_logs_actor_account", ondelete="RESTRICT"),
        nullable=True,
    )
    actor_role: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    target: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    classification: Mapped[str] = mapped_column(String(20), nullable=False, default="official")
    simulation_run_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey(
            "simulation_runs.id",
            name="fk_activity_logs_simulation_run",
            ondelete="RESTRICT",
        ),
        nullable=True,
    )
