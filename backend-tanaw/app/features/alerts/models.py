"""Normalized condition state for durable operational alerts."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class SiteSyncAlertState(Base):
    __tablename__ = "site_sync_alert_states"
    __table_args__ = (
        ForeignKeyConstraint(
            ["enterprise_id", "classification"],
            ["enterprises.id", "enterprises.classification"],
            name="fk_site_sync_alert_states_enterprise_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["site_id", "enterprise_id", "classification"],
            [
                "enterprise_sites.id",
                "enterprise_sites.enterprise_id",
                "enterprise_sites.classification",
            ],
            name="fk_site_sync_alert_states_site_scope",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["edge_device_id", "site_id", "classification"],
            ["edge_devices.id", "edge_devices.site_id", "edge_devices.classification"],
            name="fk_site_sync_alert_states_device_scope",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "classification IN ('official', 'simulation')",
            name="ck_site_sync_alert_states_classification",
        ),
        CheckConstraint(
            "status IN ('active', 'resolved')",
            name="ck_site_sync_alert_states_status",
        ),
        CheckConstraint("logical_version >= 1", name="ck_site_sync_alert_states_version"),
        CheckConstraint("pending_count >= 0", name="ck_site_sync_alert_states_pending"),
        CheckConstraint(
            "(pending_count = 0 AND oldest_pending_at IS NULL) OR "
            "(pending_count > 0 AND oldest_pending_at IS NOT NULL)",
            name="ck_site_sync_alert_states_oldest",
        ),
        CheckConstraint(
            "(last_failure_at IS NULL AND last_failure_class IS NULL) OR "
            "(last_failure_at IS NOT NULL AND last_failure_class IS NOT NULL)",
            name="ck_site_sync_alert_states_failure",
        ),
        CheckConstraint(
            "(status = 'active' AND resolved_at IS NULL) OR "
            "(status = 'resolved' AND resolved_at IS NOT NULL)",
            name="ck_site_sync_alert_states_resolution",
        ),
        CheckConstraint(
            "pending_count_threshold > recovery_pending_count_threshold "
            "AND recovery_pending_count_threshold >= 0",
            name="ck_site_sync_alert_states_count_policy",
        ),
        CheckConstraint(
            "oldest_age_threshold_seconds > recovery_age_threshold_seconds "
            "AND recovery_age_threshold_seconds >= 0",
            name="ck_site_sync_alert_states_age_policy",
        ),
        UniqueConstraint("site_id", "classification", name="uq_site_sync_alert_states_site"),
        Index("ix_site_sync_alert_states_status", "classification", "status", "updated_at"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    enterprise_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    site_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    edge_device_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    operational_alert_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("operational_alerts.id", ondelete="RESTRICT"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    logical_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    pending_count: Mapped[int] = mapped_column(Integer, nullable=False)
    oldest_pending_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_acknowledged_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_failure_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_failure_class: Mapped[str | None] = mapped_column(String(120), nullable=True)
    pending_count_threshold: Mapped[int] = mapped_column(Integer, nullable=False)
    oldest_age_threshold_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    recovery_pending_count_threshold: Mapped[int] = mapped_column(Integer, nullable=False)
    recovery_age_threshold_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_evaluated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
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
