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
    UniqueConstraint,
    Uuid,
    func,
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
        String(36), ForeignKey("operational_alerts.id", ondelete="RESTRICT"), nullable=False
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
