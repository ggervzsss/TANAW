from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Sequence,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:
    from app.features.accounts.models import EnterpriseProfile


class EnterpriseTelemetrySnapshot(Base):
    __tablename__ = "enterprise_telemetry_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    enterprise_profile_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(
            "enterprise_profiles.account_id",
            name="fk_enterprise_telemetry_snapshots_enterprise_profile_id",
            ondelete="RESTRICT",
        ),
        nullable=False,
    )
    enterprise_name: Mapped[str] = mapped_column(String(120), nullable=False)
    camera_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    camera_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    entries: Mapped[int | None] = mapped_column(Integer, nullable=True)
    exits: Mapped[int | None] = mapped_column(Integer, nullable=True)
    current_occupancy: Mapped[int | None] = mapped_column(Integer, nullable=True)
    peak_occupancy: Mapped[int | None] = mapped_column(Integer, nullable=True)
    unique_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
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
    enterprise_profile: Mapped[EnterpriseProfile] = relationship(lazy="joined")


Index(
    "ix_enterprise_telemetry_snapshots_enterprise_received",
    EnterpriseTelemetrySnapshot.enterprise_profile_id,
    EnterpriseTelemetrySnapshot.received_at.desc(),
    EnterpriseTelemetrySnapshot.id.desc(),
)


class DesktopLocalBackup(Base):
    """The latest copy of one enterprise's unsubmitted desktop data, replaced on every upload."""

    __tablename__ = "desktop_local_backups"

    enterprise_profile_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey(
            "enterprise_profiles.account_id",
            name="fk_desktop_local_backups_enterprise_profile_id",
            ondelete="CASCADE",
        ),
        primary_key=True,
    )
    device_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # Increases on every saved upload; a desktop must name the revision it last saw.
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    schema_version: Mapped[int] = mapped_column(Integer, nullable=False)
    day_count: Mapped[int] = mapped_column(Integer, nullable=False)
    draft_count: Mapped[int] = mapped_column(Integer, nullable=False)
    submission_count: Mapped[int] = mapped_column(Integer, nullable=False)
    camera_count: Mapped[int] = mapped_column(Integer, nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)


OPERATIONAL_ALERT_CODE_SEQUENCE = Sequence(
    "operational_alert_code_sequence", start=1, metadata=Base.metadata
)


class OperationalAlert(Base):
    """A live alert: a place busier than usual, or a camera that is not counting.

    Camera alerts start as Pending and become Active once the problem has lasted the camera
    wait time set by IT; an alert Ends by itself when its problem clears.
    """

    __tablename__ = "operational_alerts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    alert_code: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    alert_type: Mapped[str] = mapped_column(String(40), index=True, nullable=False)
    severity: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    enterprise_profile_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    enterprise: Mapped[str | None] = mapped_column(String(120), nullable=True)
    camera: Mapped[str | None] = mapped_column(String(120), nullable=True)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), index=True, nullable=False, default="Pending")
    source_id: Mapped[str | None] = mapped_column(String(120), index=True, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
