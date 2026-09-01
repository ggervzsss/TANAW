from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
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
    enterprise_profile: Mapped[EnterpriseProfile] = relationship(lazy="joined")


Index(
    "ix_enterprise_telemetry_snapshots_enterprise_received",
    EnterpriseTelemetrySnapshot.enterprise_profile_id,
    EnterpriseTelemetrySnapshot.received_at.desc(),
    EnterpriseTelemetrySnapshot.id.desc(),
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
