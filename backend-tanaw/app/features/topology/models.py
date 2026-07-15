from datetime import datetime
from enum import StrEnum
from uuid import uuid4

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class TopologyClassification(StrEnum):
    OFFICIAL = "official"
    SIMULATION = "simulation"


class MembershipRole(StrEnum):
    OWNER = "owner"
    MANAGER = "manager"
    VIEWER = "viewer"


class Enterprise(Base):
    __tablename__ = "enterprises"
    __table_args__ = (
        CheckConstraint(
            "classification IN ('official', 'simulation')",
            name="ck_enterprises_classification",
        ),
        CheckConstraint(
            "lifecycle_state IN ('active', 'inactive', 'retired')",
            name="ck_enterprises_lifecycle_state",
        ),
        CheckConstraint(
            "length(trim(official_code)) > 0 AND length(trim(name)) > 0",
            name="ck_enterprises_identity",
        ),
        CheckConstraint(
            "(classification = 'official' AND simulation_run_id IS NULL) OR "
            "(classification = 'simulation' AND simulation_run_id IS NOT NULL)",
            name="ck_enterprises_simulation_run_scope",
        ),
        UniqueConstraint("official_code", name="uq_enterprises_official_code"),
        UniqueConstraint("id", "classification", name="uq_enterprises_id_classification"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    official_code: Mapped[str] = mapped_column(String(120), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    category: Mapped[str | None] = mapped_column(String(120), nullable=True)
    classification: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    simulation_run_id: Mapped[str | None] = mapped_column(
        Uuid(as_uuid=False),
        ForeignKey("simulation_runs.id", ondelete="RESTRICT"),
        index=True,
        nullable=True,
    )
    lifecycle_state: Mapped[str] = mapped_column(
        String(20), index=True, nullable=False, default="active"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class EnterpriseMembership(Base):
    __tablename__ = "enterprise_memberships"
    __table_args__ = (
        ForeignKeyConstraint(
            ["enterprise_id", "classification"],
            ["enterprises.id", "enterprises.classification"],
            name="fk_enterprise_memberships_enterprise_classification",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "classification IN ('official', 'simulation')",
            name="ck_enterprise_memberships_classification",
        ),
        CheckConstraint(
            "membership_role IN ('owner', 'manager', 'viewer')",
            name="ck_enterprise_memberships_role",
        ),
        CheckConstraint(
            "ended_at IS NULL OR ended_at > started_at",
            name="ck_enterprise_memberships_effective_range",
        ),
        Index(
            "uq_enterprise_memberships_active_account",
            "account_id",
            unique=True,
            postgresql_where=text("ended_at IS NULL"),
            sqlite_where=text("ended_at IS NULL"),
        ),
        Index(
            "ix_enterprise_memberships_enterprise_active",
            "enterprise_id",
            "ended_at",
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    enterprise_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    account_id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=False
    )
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    membership_role: Mapped[str] = mapped_column(
        String(20), nullable=False, default=MembershipRole.MANAGER
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class EnterpriseSite(Base):
    __tablename__ = "enterprise_sites"
    __table_args__ = (
        ForeignKeyConstraint(
            ["enterprise_id", "classification"],
            ["enterprises.id", "enterprises.classification"],
            name="fk_enterprise_sites_enterprise_classification",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "classification IN ('official', 'simulation')",
            name="ck_enterprise_sites_classification",
        ),
        CheckConstraint(
            "retired_at IS NULL OR retired_at > registered_at",
            name="ck_enterprise_sites_effective_range",
        ),
        CheckConstraint(
            "length(trim(site_code)) > 0 AND length(trim(name)) > 0",
            name="ck_enterprise_sites_identity",
        ),
        UniqueConstraint(
            "enterprise_id",
            "site_code",
            name="uq_enterprise_sites_code",
        ),
        UniqueConstraint(
            "id",
            "enterprise_id",
            "classification",
            name="uq_enterprise_sites_identity_scope",
        ),
        UniqueConstraint("id", "classification", name="uq_enterprise_sites_id_classification"),
        Index("ix_enterprise_sites_enterprise_retired", "enterprise_id", "retired_at"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    enterprise_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    site_code: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    registered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class SiteLocationVersion(Base):
    """Immutable location evidence for a stable enterprise-site identity."""

    __tablename__ = "site_location_versions"
    __table_args__ = (
        ForeignKeyConstraint(
            ["site_id", "classification"],
            ["enterprise_sites.id", "enterprise_sites.classification"],
            name="fk_site_location_versions_site_classification",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "classification IN ('official', 'simulation')",
            name="ck_site_location_versions_classification",
        ),
        CheckConstraint("version >= 1", name="ck_site_location_versions_version"),
        CheckConstraint(
            "building_capacity BETWEEN 1 AND 100000",
            name="ck_site_location_versions_building_capacity",
        ),
        CheckConstraint(
            "timezone_name = 'Asia/Manila'",
            name="ck_site_location_versions_timezone",
        ),
        CheckConstraint(
            "((latitude IS NULL AND longitude IS NULL) OR "
            "(latitude IS NOT NULL AND longitude IS NOT NULL AND "
            "latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))",
            name="ck_site_location_versions_coordinates",
        ),
        CheckConstraint(
            "location_confidence IS NULL OR "
            "(latitude IS NOT NULL AND location_confidence BETWEEN 0 AND 1)",
            name="ck_site_location_versions_confidence",
        ),
        CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_site_location_versions_effective_range",
        ),
        UniqueConstraint("site_id", "version", name="uq_site_location_versions_site_version"),
        Index(
            "uq_site_location_versions_current_site",
            "site_id",
            unique=True,
            postgresql_where=text("effective_to IS NULL"),
            sqlite_where=text("effective_to IS NULL"),
        ),
        Index("ix_site_location_versions_site_effective", "site_id", "effective_from"),
        Index("ix_site_location_versions_barangay", "barangay"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    site_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    barangay: Mapped[str | None] = mapped_column(String(120), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    timezone_name: Mapped[str] = mapped_column(String(64), nullable=False, default="Asia/Manila")
    building_capacity: Mapped[int] = mapped_column(Integer, nullable=False)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    location_source: Mapped[str | None] = mapped_column(String(40), nullable=True)
    location_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    geocoded_address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    coordinates_confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    change_reason: Mapped[str] = mapped_column(String(80), nullable=False)
    effective_from: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    effective_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class EdgeDevice(Base):
    __tablename__ = "edge_devices"
    __table_args__ = (
        ForeignKeyConstraint(
            ["site_id", "classification"],
            ["enterprise_sites.id", "enterprise_sites.classification"],
            name="fk_edge_devices_site_classification",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "classification IN ('official', 'simulation')",
            name="ck_edge_devices_classification",
        ),
        CheckConstraint(
            "lifecycle_state IN ('active', 'retired', 'revoked')",
            name="ck_edge_devices_lifecycle_state",
        ),
        CheckConstraint(
            "device_role IN ('telemetry_aggregator', 'camera_node')",
            name="ck_edge_devices_device_role",
        ),
        CheckConstraint(
            "credential_version >= 1",
            name="ck_edge_devices_credential_version",
        ),
        CheckConstraint(
            "contract_version IS NULL OR contract_version >= 1",
            name="ck_edge_devices_contract_version",
        ),
        CheckConstraint(
            "length(trim(device_key)) > 0 AND length(trim(display_name)) > 0",
            name="ck_edge_devices_identity",
        ),
        UniqueConstraint("device_key", name="uq_edge_devices_device_key"),
        UniqueConstraint(
            "id",
            "site_id",
            "classification",
            name="uq_edge_devices_id_site_classification",
        ),
        Index("ix_edge_devices_site_lifecycle", "site_id", "lifecycle_state"),
        Index(
            "uq_edge_devices_active_aggregator_site",
            "site_id",
            unique=True,
            postgresql_where=text(
                "lifecycle_state = 'active' AND device_role = 'telemetry_aggregator'"
            ),
            sqlite_where=text(
                "lifecycle_state = 'active' AND device_role = 'telemetry_aggregator'"
            ),
        ),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    site_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    device_key: Mapped[str] = mapped_column(String(120), nullable=False)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    device_role: Mapped[str] = mapped_column(
        String(30), nullable=False, default="telemetry_aggregator"
    )
    lifecycle_state: Mapped[str] = mapped_column(
        String(20), index=True, nullable=False, default="active"
    )
    counter_epoch: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), nullable=False, default=lambda: str(uuid4())
    )
    credential_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    client_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    contract_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    release_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    paired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    credential_rotated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_authenticated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Camera(Base):
    __tablename__ = "cameras"
    __table_args__ = (
        ForeignKeyConstraint(
            ["site_id", "classification"],
            ["enterprise_sites.id", "enterprise_sites.classification"],
            name="fk_cameras_site_classification",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["edge_device_id", "site_id", "classification"],
            ["edge_devices.id", "edge_devices.site_id", "edge_devices.classification"],
            name="fk_cameras_device_site_classification",
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "classification IN ('official', 'simulation')",
            name="ck_cameras_classification",
        ),
        CheckConstraint(
            "lifecycle_state IN ('active', 'retired')",
            name="ck_cameras_lifecycle_state",
        ),
        CheckConstraint(
            "length(trim(camera_key)) > 0 AND length(trim(display_name)) > 0",
            name="ck_cameras_identity",
        ),
        UniqueConstraint("edge_device_id", "camera_key", name="uq_cameras_device_camera_key"),
        UniqueConstraint(
            "id", "site_id", "classification", name="uq_cameras_id_site_classification"
        ),
        Index("ix_cameras_site_lifecycle", "site_id", "lifecycle_state"),
    )

    id: Mapped[str] = mapped_column(
        Uuid(as_uuid=False), primary_key=True, default=lambda: str(uuid4())
    )
    site_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    edge_device_id: Mapped[str] = mapped_column(Uuid(as_uuid=False), nullable=False)
    classification: Mapped[str] = mapped_column(String(20), nullable=False)
    camera_key: Mapped[str] = mapped_column(String(120), nullable=False)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    lifecycle_state: Mapped[str] = mapped_column(
        String(20), index=True, nullable=False, default="active"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
