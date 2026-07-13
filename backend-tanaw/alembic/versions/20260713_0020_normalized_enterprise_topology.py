"""Add normalized enterprise topology and backfill enterprise accounts.

Revision ID: 20260713_0020
Revises: 20260712_0019

This development-sequencing migration is additive. It deliberately leaves the
legacy account columns in place until target-only readers and writers are ready
for the rehearsed hard cutover. The topology backfill is deterministic and
idempotent, so an interrupted rehearsal can restart from its external backup or
rerun the transformation against an unchanged source snapshot.

The membership account FK remains VARCHAR(36) only because accounts.id has not
yet been converted to native PostgreSQL UUID. That is explicit cutover debt;
every new topology identifier in this revision uses native UUID.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast
from uuid import UUID, uuid5

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from alembic import op

revision: str = "20260713_0020"
down_revision: str | Sequence[str] | None = "20260712_0019"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TOPOLOGY_NAMESPACE = UUID("ef15af2c-cdbf-4bb6-a7af-aa2821e93630")


@dataclass(frozen=True)
class _TopologyRows:
    enterprise: Mapping[str, object]
    membership: Mapping[str, object]
    site: Mapping[str, object]
    device: Mapping[str, object] | None


def upgrade() -> None:
    _create_topology_tables()
    _backfill_enterprise_topology(op.get_bind())


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260713_0020 is intentionally irreversible because normalized topology "
        "may contain device and camera identity created after the account backfill. Restore "
        "a verified backup or deploy a forward fix instead."
    )


def _create_topology_tables() -> None:
    classification_check = "classification IN ('official', 'simulation')"

    op.create_table(
        "enterprises",
        sa.Column("id", sa.Uuid(as_uuid=False), nullable=False),
        sa.Column("official_code", sa.String(length=120), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("category", sa.String(length=120), nullable=True),
        sa.Column("classification", sa.String(length=20), nullable=False),
        sa.Column("lifecycle_state", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(classification_check, name="ck_enterprises_classification"),
        sa.CheckConstraint(
            "lifecycle_state IN ('active', 'inactive', 'retired')",
            name="ck_enterprises_lifecycle_state",
        ),
        sa.CheckConstraint(
            "length(trim(official_code)) > 0 AND length(trim(name)) > 0",
            name="ck_enterprises_identity",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("official_code", name="uq_enterprises_official_code"),
        sa.UniqueConstraint("id", "classification", name="uq_enterprises_id_classification"),
    )
    op.create_index("ix_enterprises_classification", "enterprises", ["classification"])
    op.create_index("ix_enterprises_lifecycle_state", "enterprises", ["lifecycle_state"])

    op.create_table(
        "enterprise_memberships",
        sa.Column("id", sa.Uuid(as_uuid=False), nullable=False),
        sa.Column("enterprise_id", sa.Uuid(as_uuid=False), nullable=False),
        # Cutover debt: this FK must change to UUID with accounts.id.
        sa.Column("account_id", sa.String(length=36), nullable=False),
        sa.Column("classification", sa.String(length=20), nullable=False),
        sa.Column(
            "membership_role", sa.String(length=20), nullable=False, server_default="manager"
        ),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(classification_check, name="ck_enterprise_memberships_classification"),
        sa.CheckConstraint(
            "membership_role IN ('owner', 'manager', 'viewer')",
            name="ck_enterprise_memberships_role",
        ),
        sa.CheckConstraint(
            "ended_at IS NULL OR ended_at > started_at",
            name="ck_enterprise_memberships_effective_range",
        ),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["enterprise_id", "classification"],
            ["enterprises.id", "enterprises.classification"],
            name="fk_enterprise_memberships_enterprise_classification",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_enterprise_memberships_active_account",
        "enterprise_memberships",
        ["account_id"],
        unique=True,
        postgresql_where=sa.text("ended_at IS NULL"),
        sqlite_where=sa.text("ended_at IS NULL"),
    )
    op.create_index(
        "ix_enterprise_memberships_enterprise_active",
        "enterprise_memberships",
        ["enterprise_id", "ended_at"],
    )

    op.create_table(
        "enterprise_sites",
        sa.Column("id", sa.Uuid(as_uuid=False), nullable=False),
        sa.Column("enterprise_id", sa.Uuid(as_uuid=False), nullable=False),
        sa.Column("classification", sa.String(length=20), nullable=False),
        sa.Column("site_code", sa.String(length=80), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("barangay", sa.String(length=120), nullable=True),
        sa.Column("address", sa.String(length=255), nullable=True),
        sa.Column(
            "timezone_name", sa.String(length=64), nullable=False, server_default="Asia/Manila"
        ),
        sa.Column("building_capacity", sa.Integer(), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=True),
        sa.Column("longitude", sa.Float(), nullable=True),
        sa.Column("location_source", sa.String(length=40), nullable=True),
        sa.Column("location_confidence", sa.Float(), nullable=True),
        sa.Column("geocoded_address", sa.String(length=500), nullable=True),
        sa.Column("coordinates_updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("location_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "effective_from",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("effective_to", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(classification_check, name="ck_enterprise_sites_classification"),
        sa.CheckConstraint(
            "building_capacity BETWEEN 1 AND 100000",
            name="ck_enterprise_sites_building_capacity",
        ),
        sa.CheckConstraint(
            "((latitude IS NULL AND longitude IS NULL) OR "
            "(latitude IS NOT NULL AND longitude IS NOT NULL AND "
            "latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))",
            name="ck_enterprise_sites_coordinates",
        ),
        sa.CheckConstraint(
            "location_confidence IS NULL OR "
            "(latitude IS NOT NULL AND location_confidence BETWEEN 0 AND 1)",
            name="ck_enterprise_sites_location_confidence",
        ),
        sa.CheckConstraint("timezone_name = 'Asia/Manila'", name="ck_enterprise_sites_timezone"),
        sa.CheckConstraint("location_version >= 1", name="ck_enterprise_sites_location_version"),
        sa.CheckConstraint(
            "effective_to IS NULL OR effective_to > effective_from",
            name="ck_enterprise_sites_effective_range",
        ),
        sa.CheckConstraint(
            "length(trim(site_code)) > 0 AND length(trim(name)) > 0",
            name="ck_enterprise_sites_identity",
        ),
        sa.ForeignKeyConstraint(
            ["enterprise_id", "classification"],
            ["enterprises.id", "enterprises.classification"],
            name="fk_enterprise_sites_enterprise_classification",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "enterprise_id",
            "site_code",
            "location_version",
            name="uq_enterprise_sites_code_version",
        ),
        sa.UniqueConstraint("id", "classification", name="uq_enterprise_sites_id_classification"),
    )
    op.create_index(
        "uq_enterprise_sites_active_code",
        "enterprise_sites",
        ["enterprise_id", "site_code"],
        unique=True,
        postgresql_where=sa.text("effective_to IS NULL"),
        sqlite_where=sa.text("effective_to IS NULL"),
    )
    op.create_index(
        "ix_enterprise_sites_enterprise_effective",
        "enterprise_sites",
        ["enterprise_id", "effective_to"],
    )
    op.create_index("ix_enterprise_sites_barangay", "enterprise_sites", ["barangay"])

    op.create_table(
        "edge_devices",
        sa.Column("id", sa.Uuid(as_uuid=False), nullable=False),
        sa.Column("site_id", sa.Uuid(as_uuid=False), nullable=False),
        sa.Column("classification", sa.String(length=20), nullable=False),
        sa.Column("device_key", sa.String(length=120), nullable=False),
        sa.Column("display_name", sa.String(length=160), nullable=False),
        sa.Column("lifecycle_state", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("counter_epoch", sa.Uuid(as_uuid=False), nullable=False),
        sa.Column("credential_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("client_version", sa.String(length=40), nullable=True),
        sa.Column("contract_version", sa.Integer(), nullable=True),
        sa.Column("release_id", sa.String(length=120), nullable=True),
        sa.Column("paired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("credential_rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_authenticated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(classification_check, name="ck_edge_devices_classification"),
        sa.CheckConstraint(
            "lifecycle_state IN ('active', 'retired', 'revoked')",
            name="ck_edge_devices_lifecycle_state",
        ),
        sa.CheckConstraint("credential_version >= 1", name="ck_edge_devices_credential_version"),
        sa.CheckConstraint(
            "contract_version IS NULL OR contract_version >= 1",
            name="ck_edge_devices_contract_version",
        ),
        sa.CheckConstraint(
            "length(trim(device_key)) > 0 AND length(trim(display_name)) > 0",
            name="ck_edge_devices_identity",
        ),
        sa.ForeignKeyConstraint(
            ["site_id", "classification"],
            ["enterprise_sites.id", "enterprise_sites.classification"],
            name="fk_edge_devices_site_classification",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_key", name="uq_edge_devices_device_key"),
        sa.UniqueConstraint(
            "id",
            "site_id",
            "classification",
            name="uq_edge_devices_id_site_classification",
        ),
    )
    op.create_index("ix_edge_devices_lifecycle_state", "edge_devices", ["lifecycle_state"])
    op.create_index(
        "ix_edge_devices_site_lifecycle",
        "edge_devices",
        ["site_id", "lifecycle_state"],
    )

    op.create_table(
        "cameras",
        sa.Column("id", sa.Uuid(as_uuid=False), nullable=False),
        sa.Column("site_id", sa.Uuid(as_uuid=False), nullable=False),
        sa.Column("edge_device_id", sa.Uuid(as_uuid=False), nullable=False),
        sa.Column("classification", sa.String(length=20), nullable=False),
        sa.Column("camera_key", sa.String(length=120), nullable=False),
        sa.Column("display_name", sa.String(length=160), nullable=False),
        sa.Column("lifecycle_state", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.CheckConstraint(classification_check, name="ck_cameras_classification"),
        sa.CheckConstraint(
            "lifecycle_state IN ('active', 'retired')",
            name="ck_cameras_lifecycle_state",
        ),
        sa.CheckConstraint(
            "length(trim(camera_key)) > 0 AND length(trim(display_name)) > 0",
            name="ck_cameras_identity",
        ),
        sa.ForeignKeyConstraint(
            ["site_id", "classification"],
            ["enterprise_sites.id", "enterprise_sites.classification"],
            name="fk_cameras_site_classification",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["edge_device_id", "site_id", "classification"],
            ["edge_devices.id", "edge_devices.site_id", "edge_devices.classification"],
            name="fk_cameras_device_site_classification",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("edge_device_id", "camera_key", name="uq_cameras_device_camera_key"),
    )
    op.create_index("ix_cameras_lifecycle_state", "cameras", ["lifecycle_state"])
    op.create_index("ix_cameras_site_lifecycle", "cameras", ["site_id", "lifecycle_state"])


def _backfill_enterprise_topology(connection: Connection) -> None:
    account_rows = connection.execute(
        sa.text(
            """
            SELECT id, enterprise_id, enterprise_name, display_name, category,
                   barangay, address, latitude, longitude, location_source,
                   location_confidence, geocoded_address, location_updated_at,
                   gateway_id, building_capacity, source_kind, status::text AS status,
                   created_at, updated_at
            FROM accounts
            WHERE role::text = 'ENTERPRISE'
              AND is_protected_system_account = false
            ORDER BY id
            """
        )
    ).mappings()
    topology_rows = [
        _topology_rows_for_account(cast("Mapping[str, Any]", account)) for account in account_rows
    ]
    _validate_unique_business_keys(topology_rows)

    for rows in topology_rows:
        connection.execute(_ENTERPRISE_INSERT, rows.enterprise)
        connection.execute(_MEMBERSHIP_INSERT, rows.membership)
        connection.execute(_SITE_INSERT, rows.site)
        if rows.device is not None:
            connection.execute(_DEVICE_INSERT, rows.device)


def _topology_rows_for_account(account: Mapping[str, Any]) -> _TopologyRows:
    account_id = _required_text(account.get("id"), "account id")
    source_kind = _required_text(account.get("source_kind"), f"source_kind for {account_id}")
    classification = _classification_for_source_kind(source_kind, account_id)
    status = _required_text(account.get("status"), f"status for {account_id}").upper()
    if status not in {"ACTIVE", "INACTIVE"}:
        raise RuntimeError(f"Enterprise account {account_id} has unsupported status {status!r}")

    enterprise_id = _deterministic_uuid("enterprise", account_id)
    site_id = _deterministic_uuid("site", f"{enterprise_id}:primary")
    membership_id = _deterministic_uuid("membership", f"{enterprise_id}:{account_id}")
    official_code = _optional_text(account.get("enterprise_id")) or account_id
    enterprise_name = (
        _optional_text(account.get("enterprise_name"))
        or _optional_text(account.get("display_name"))
        or official_code
    )
    created_at = _required_datetime(account.get("created_at"), account_id, "created_at")
    updated_at = _required_datetime(account.get("updated_at"), account_id, "updated_at")
    latitude, longitude = _validated_coordinates(account, account_id)
    location_confidence = _validated_location_confidence(account, account_id, latitude)
    capacity = _validated_capacity(account.get("building_capacity"), account_id)

    enterprise = {
        "id": enterprise_id,
        "official_code": official_code,
        "name": enterprise_name,
        "category": _optional_text(account.get("category")),
        "classification": classification,
        "lifecycle_state": "active" if status == "ACTIVE" else "inactive",
        "created_at": created_at,
        "updated_at": updated_at,
    }
    membership = {
        "id": membership_id,
        "enterprise_id": enterprise_id,
        "account_id": account_id,
        "classification": classification,
        "membership_role": "manager",
        "started_at": created_at,
        "created_at": created_at,
    }
    site = {
        "id": site_id,
        "enterprise_id": enterprise_id,
        "classification": classification,
        "site_code": "primary",
        "name": f"{enterprise_name} Primary Site",
        "barangay": _optional_text(account.get("barangay")),
        "address": _optional_text(account.get("address")),
        "timezone_name": "Asia/Manila",
        "building_capacity": capacity,
        "latitude": latitude,
        "longitude": longitude,
        "location_source": _optional_text(account.get("location_source")),
        "location_confidence": location_confidence,
        "geocoded_address": _optional_text(account.get("geocoded_address")),
        "coordinates_updated_at": account.get("location_updated_at"),
        "effective_from": created_at,
        "created_at": created_at,
        "updated_at": updated_at,
    }

    gateway_id = _optional_text(account.get("gateway_id"))
    device: dict[str, object] | None = None
    if gateway_id is not None:
        device_id = _deterministic_uuid("device", gateway_id)
        device = {
            "id": device_id,
            "site_id": site_id,
            "classification": classification,
            "device_key": gateway_id,
            "display_name": gateway_id,
            "counter_epoch": _deterministic_uuid("counter-epoch", device_id),
            "paired_at": created_at,
            "created_at": created_at,
            "updated_at": updated_at,
        }

    return _TopologyRows(
        enterprise=enterprise,
        membership=membership,
        site=site,
        device=device,
    )


def _classification_for_source_kind(source_kind: str, account_id: str) -> str:
    if source_kind == "real":
        return "official"
    if source_kind == "mock":
        return "simulation"
    raise RuntimeError(
        f"Enterprise account {account_id} has unsupported source_kind {source_kind!r}; "
        "topology classification cannot be guessed"
    )


def _validated_coordinates(
    account: Mapping[str, Any], account_id: str
) -> tuple[float | None, float | None]:
    latitude_value = account.get("latitude")
    longitude_value = account.get("longitude")
    if latitude_value is None and longitude_value is None:
        return None, None
    if latitude_value is None or longitude_value is None:
        raise RuntimeError(f"Enterprise account {account_id} has unpaired coordinates")

    latitude = float(latitude_value)
    longitude = float(longitude_value)
    if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
        raise RuntimeError(f"Enterprise account {account_id} has out-of-range coordinates")
    return latitude, longitude


def _validated_location_confidence(
    account: Mapping[str, Any], account_id: str, latitude: float | None
) -> float | None:
    value = account.get("location_confidence")
    if value is None:
        return None
    confidence = float(value)
    if latitude is None or not 0 <= confidence <= 1:
        raise RuntimeError(f"Enterprise account {account_id} has invalid location confidence")
    return confidence


def _validated_capacity(value: object, account_id: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= 100_000:
        raise RuntimeError(f"Enterprise account {account_id} has invalid building capacity")
    return value


def _validate_unique_business_keys(topology_rows: Sequence[_TopologyRows]) -> None:
    official_codes: dict[object, object] = {}
    device_keys: dict[object, object] = {}
    for rows in topology_rows:
        _remember_unique(
            official_codes,
            rows.enterprise["official_code"],
            rows.membership["account_id"],
            "enterprise official code",
        )
        if rows.device is not None:
            _remember_unique(
                device_keys,
                rows.device["device_key"],
                rows.membership["account_id"],
                "edge device key",
            )


def _remember_unique(
    seen: dict[object, object], key: object, account_id: object, label: str
) -> None:
    previous_account_id = seen.setdefault(key, account_id)
    if previous_account_id != account_id:
        raise RuntimeError(
            f"Duplicate {label} {key!r} belongs to accounts "
            f"{previous_account_id!r} and {account_id!r}"
        )


def _deterministic_uuid(entity_kind: str, source_identity: str) -> str:
    return str(uuid5(_TOPOLOGY_NAMESPACE, f"tanaw:{entity_kind}:{source_identity}"))


def _required_text(value: object, label: str) -> str:
    normalized = _optional_text(value)
    if normalized is None:
        raise RuntimeError(f"Missing {label} during enterprise topology backfill")
    return normalized


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _required_datetime(value: object, account_id: str, label: str) -> datetime:
    if not isinstance(value, datetime):
        raise RuntimeError(f"Enterprise account {account_id} has invalid {label}")
    return value


_ENTERPRISE_INSERT = sa.text(
    """
    INSERT INTO enterprises (
        id, official_code, name, category, classification, lifecycle_state,
        created_at, updated_at
    ) VALUES (
        CAST(:id AS UUID), :official_code, :name, :category, :classification,
        :lifecycle_state, :created_at, :updated_at
    )
    ON CONFLICT (id) DO NOTHING
    """
)

_MEMBERSHIP_INSERT = sa.text(
    """
    INSERT INTO enterprise_memberships (
        id, enterprise_id, account_id, classification, membership_role,
        started_at, created_at
    ) VALUES (
        CAST(:id AS UUID), CAST(:enterprise_id AS UUID), :account_id,
        :classification, :membership_role, :started_at, :created_at
    )
    ON CONFLICT (id) DO NOTHING
    """
)

_SITE_INSERT = sa.text(
    """
    INSERT INTO enterprise_sites (
        id, enterprise_id, classification, site_code, name, barangay, address,
        timezone_name, building_capacity, latitude, longitude, location_source,
        location_confidence, geocoded_address, coordinates_updated_at,
        location_version, effective_from, created_at, updated_at
    ) VALUES (
        CAST(:id AS UUID), CAST(:enterprise_id AS UUID), :classification,
        :site_code, :name, :barangay, :address, :timezone_name,
        :building_capacity, :latitude, :longitude, :location_source,
        :location_confidence, :geocoded_address, :coordinates_updated_at,
        1, :effective_from, :created_at, :updated_at
    )
    ON CONFLICT (id) DO NOTHING
    """
)

_DEVICE_INSERT = sa.text(
    """
    INSERT INTO edge_devices (
        id, site_id, classification, device_key, display_name, lifecycle_state,
        counter_epoch, credential_version, paired_at, created_at, updated_at
    ) VALUES (
        CAST(:id AS UUID), CAST(:site_id AS UUID), :classification, :device_key,
        :display_name, 'active', CAST(:counter_epoch AS UUID), 1, :paired_at,
        :created_at, :updated_at
    )
    ON CONFLICT (id) DO NOTHING
    """
)
