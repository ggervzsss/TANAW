"""Make normalized enterprise topology authoritative and remove account topology.

Revision ID: 20260714_0028
Revises: 20260713_0027

This is a fail-closed, irreversible cutover. It reconciles every supported
account-owned enterprise/site/device value into normalized topology, proves the
result, and physically removes the superseded account columns in the same
transaction. Recovery is an external restore of the matching pre-cutover
database and application generation; no legacy shadow table or runtime fallback
is retained.
"""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any, cast
from uuid import UUID, uuid5

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from alembic import op

revision: str = "20260714_0028"
down_revision: str | Sequence[str] | None = "20260713_0027"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TOPOLOGY_NAMESPACE = UUID("ef15af2c-cdbf-4bb6-a7af-aa2821e93630")
_SUPERSEDED_ACCOUNT_COLUMNS = (
    "enterprise_name",
    "category",
    "manager_name",
    "barangay",
    "address",
    "latitude",
    "longitude",
    "location_source",
    "location_confidence",
    "geocoded_address",
    "location_updated_at",
    "enterprise_id",
    "gateway_id",
    "gateway_status",
    "building_capacity",
    "source_kind",
    "mock_run_id",
)


def upgrade() -> None:
    connection = op.get_bind()
    _lock_cutover_tables(connection)
    _add_simulation_ownership_schema()
    _reconcile_topology(connection)
    _prove_cutover_invariants(connection)
    _drop_superseded_account_columns()


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260714_0028 is an irreversible topology cutover. Restore the verified "
        "pre-cutover backup and matching application build instead of recreating legacy columns."
    )


def _lock_cutover_tables(connection: Connection) -> None:
    connection.execute(
        sa.text(
            """
            LOCK TABLE accounts, enterprises, enterprise_memberships,
                       enterprise_sites, edge_devices, mock_data_runs
            IN SHARE ROW EXCLUSIVE MODE
            """
        )
    )


def _add_simulation_ownership_schema() -> None:
    op.create_table(
        "mock_data_run_accounts",
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("account_id", sa.String(length=36), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["run_id"], ["mock_data_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("run_id", "account_id"),
    )
    op.create_index(
        "ix_mock_data_run_accounts_account_id",
        "mock_data_run_accounts",
        ["account_id"],
    )
    op.add_column(
        "enterprises",
        sa.Column("simulation_run_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_enterprises_simulation_run_id",
        "enterprises",
        "mock_data_runs",
        ["simulation_run_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index(
        "ix_enterprises_simulation_run_id",
        "enterprises",
        ["simulation_run_id"],
    )


def _reconcile_topology(connection: Connection) -> None:
    raw_accounts = list(
        connection.execute(
            sa.text(
                """
                SELECT id, email, role::text AS role, status::text AS status,
                       is_protected_system_account, display_name, enterprise_id,
                       enterprise_name, category, manager_name, barangay, address,
                       latitude, longitude, location_source, location_confidence,
                       geocoded_address, location_updated_at, gateway_id,
                       building_capacity, source_kind, mock_run_id,
                       created_at, updated_at
                FROM accounts
                ORDER BY id
                """
            )
        ).mappings()
    )
    accounts: list[Mapping[str, Any]] = [
        cast("Mapping[str, Any]", account) for account in raw_accounts
    ]
    _validate_mock_run_references(connection, accounts)
    _backfill_mock_run_accounts(connection, accounts)
    _reject_nonenterprise_topology(connection, accounts)

    enterprise_accounts = [
        account for account in accounts if str(account["role"]).upper() == "ENTERPRISE"
    ]
    expected_codes: dict[str, str] = {}
    expected_gateways: dict[str, str] = {}
    for account in enterprise_accounts:
        projection = _account_projection(account)
        _remember_unique(
            expected_codes,
            cast(str, projection["official_code"]).casefold(),
            cast(str, projection["account_id"]),
            "enterprise official code",
        )
        gateway_key = cast(str | None, projection["gateway_key"])
        if gateway_key is not None:
            _remember_unique(
                expected_gateways,
                gateway_key,
                cast(str, projection["account_id"]),
                "edge device key",
            )

    for account in enterprise_accounts:
        _reconcile_enterprise_account(connection, account)


def _validate_mock_run_references(
    connection: Connection, accounts: Sequence[Mapping[str, Any]]
) -> None:
    referenced_ids = {
        run_id
        for account in accounts
        if (run_id := _optional_text(account.get("mock_run_id"))) is not None
    }
    if not referenced_ids:
        return
    existing = set(
        connection.execute(
            sa.text("SELECT id FROM mock_data_runs WHERE id = ANY(:run_ids)"),
            {"run_ids": list(referenced_ids)},
        ).scalars()
    )
    missing = sorted(referenced_ids - existing)
    if missing:
        raise RuntimeError(
            "Account mock-run ownership references missing mock_data_runs: " + ", ".join(missing)
        )


def _backfill_mock_run_accounts(
    connection: Connection, accounts: Sequence[Mapping[str, Any]]
) -> None:
    for account in accounts:
        run_id = _optional_text(account.get("mock_run_id"))
        if run_id is None:
            continue
        connection.execute(
            sa.text(
                """
                INSERT INTO mock_data_run_accounts (run_id, account_id, created_at)
                VALUES (:run_id, :account_id, :created_at)
                ON CONFLICT (run_id, account_id) DO NOTHING
                """
            ),
            {
                "run_id": run_id,
                "account_id": _required_text(account.get("id"), "account id"),
                "created_at": _required_datetime(
                    account.get("created_at"),
                    _required_text(account.get("id"), "account id"),
                    "created_at",
                ),
            },
        )


def _reject_nonenterprise_topology(
    connection: Connection, accounts: Sequence[Mapping[str, Any]]
) -> None:
    forbidden_ids = [
        str(account["id"])
        for account in accounts
        if str(account["role"]).upper() != "ENTERPRISE"
        or bool(account["is_protected_system_account"])
    ]
    if not forbidden_ids:
        return
    violations = list(
        connection.execute(
            sa.text(
                """
                SELECT DISTINCT account_id
                FROM enterprise_memberships
                WHERE account_id = ANY(:account_ids)
                ORDER BY account_id
                """
            ),
            {"account_ids": forbidden_ids},
        ).scalars()
    )
    if violations:
        raise RuntimeError(
            "LGU or protected accounts own forbidden enterprise topology: " + ", ".join(violations)
        )


def _reconcile_enterprise_account(connection: Connection, account: Mapping[str, Any]) -> None:
    projection = _account_projection(account)
    account_id = cast(str, projection["account_id"])
    if bool(account.get("is_protected_system_account")):
        raise RuntimeError(f"Protected account {account_id} cannot be an enterprise principal")

    memberships = list(
        connection.execute(
            sa.text(
                """
                SELECT id::text AS id, enterprise_id::text AS enterprise_id,
                       classification, started_at, ended_at
                FROM enterprise_memberships
                WHERE account_id = :account_id AND ended_at IS NULL
                ORDER BY id
                """
            ),
            {"account_id": account_id},
        ).mappings()
    )
    if len(memberships) > 1:
        raise RuntimeError(f"Enterprise account {account_id} has multiple active memberships")
    if memberships:
        membership = memberships[0]
        if (
            str(membership["id"]) != projection["membership_uuid"]
            or str(membership["enterprise_id"]) != projection["enterprise_uuid"]
            or membership["classification"] != projection["classification"]
        ):
            raise RuntimeError(
                f"Enterprise account {account_id} has a non-deterministic or mismatched membership"
            )

    _ensure_business_key_available(connection, projection)
    connection.execute(_ENTERPRISE_UPSERT, projection)
    if not memberships:
        connection.execute(_MEMBERSHIP_INSERT, projection)

    _reconcile_primary_site(connection, projection)
    _reconcile_gateway_device(connection, projection)
    connection.execute(
        sa.text("UPDATE accounts SET display_name = :manager_name WHERE id = :account_id"),
        {
            "manager_name": projection["manager_name"],
            "account_id": account_id,
        },
    )


def _ensure_business_key_available(
    connection: Connection, projection: Mapping[str, object]
) -> None:
    conflict = connection.execute(
        sa.text(
            """
            SELECT id::text
            FROM enterprises
            WHERE official_code = :official_code
              AND id <> CAST(:enterprise_uuid AS UUID)
            """
        ),
        projection,
    ).scalar_one_or_none()
    if conflict is not None:
        raise RuntimeError(
            f"Enterprise official code {projection['official_code']!r} is owned by {conflict}"
        )
    existing = (
        connection.execute(
            sa.text(
                """
            SELECT official_code, classification
            FROM enterprises
            WHERE id = CAST(:enterprise_uuid AS UUID)
            """
            ),
            projection,
        )
        .mappings()
        .one_or_none()
    )
    if existing is not None and (
        existing["official_code"] != projection["official_code"]
        or existing["classification"] != projection["classification"]
    ):
        raise RuntimeError(
            f"Enterprise {projection['enterprise_uuid']} has conflicting immutable identity"
        )


def _reconcile_primary_site(
    connection: Connection, projection: Mapping[str, object]
) -> Mapping[str, Any]:
    sites = list(
        connection.execute(
            sa.text(
                """
                SELECT id::text AS id, classification, name, barangay, address,
                       building_capacity, latitude, longitude, location_source,
                       location_confidence, geocoded_address, coordinates_updated_at,
                       location_version
                FROM enterprise_sites
                WHERE enterprise_id = CAST(:enterprise_uuid AS UUID)
                  AND site_code = 'primary' AND effective_to IS NULL
                ORDER BY id
                """
            ),
            projection,
        ).mappings()
    )
    if len(sites) > 1:
        raise RuntimeError(
            f"Enterprise {projection['enterprise_uuid']} has multiple effective primary sites"
        )
    if not sites:
        collision = connection.execute(
            sa.text("SELECT id::text FROM enterprise_sites WHERE id = CAST(:site_uuid AS UUID)"),
            projection,
        ).scalar_one_or_none()
        if collision is not None:
            raise RuntimeError(
                f"Deterministic primary site {projection['site_uuid']} is already historical or foreign"
            )
        connection.execute(_SITE_INSERT, projection)
        return {
            "id": projection["site_uuid"],
            "classification": projection["classification"],
        }

    site = cast("Mapping[str, Any]", sites[0])
    if (
        str(site["id"]) != projection["site_uuid"]
        or site["classification"] != projection["classification"]
    ):
        raise RuntimeError(
            f"Enterprise {projection['enterprise_uuid']} has a non-deterministic primary site"
        )
    values = _site_reconciliation_values(site, projection)
    connection.execute(_SITE_UPDATE, values)
    return site


def _site_reconciliation_values(
    site: Mapping[str, Any], projection: Mapping[str, object]
) -> dict[str, object]:
    """Build an atomic site edit while preserving stable site-scope identity."""

    address_changed = (
        site["address"] != projection["address"] or site["barangay"] != projection["barangay"]
    )
    coordinate_changed = any(
        site[column] != projection[column]
        for column in (
            "latitude",
            "longitude",
            "location_source",
            "location_confidence",
            "geocoded_address",
            "coordinates_updated_at",
        )
    )
    values = dict(projection)
    values["next_location_version"] = int(site["location_version"]) + (
        1 if address_changed or coordinate_changed else 0
    )
    if address_changed:
        for column in (
            "latitude",
            "longitude",
            "location_source",
            "location_confidence",
            "geocoded_address",
            "coordinates_updated_at",
        ):
            values[column] = None
    return values


def _reconcile_gateway_device(
    connection: Connection,
    projection: Mapping[str, object],
) -> None:
    devices = list(
        connection.execute(
            sa.text(
                """
                SELECT id::text AS id, device_key, classification
                FROM edge_devices
                WHERE site_id = CAST(:site_uuid AS UUID) AND lifecycle_state = 'active'
                ORDER BY id
                """
            ),
            projection,
        ).mappings()
    )
    if len(devices) > 1:
        raise RuntimeError(
            f"Primary site {projection['site_uuid']} has multiple active edge devices"
        )
    gateway_key = cast(str | None, projection["gateway_key"])
    if gateway_key is None:
        return
    if devices:
        device = devices[0]
        if (
            device["device_key"] != gateway_key
            or device["classification"] != projection["classification"]
        ):
            raise RuntimeError(
                f"Primary site {projection['site_uuid']} has a conflicting gateway identity"
            )
        return
    conflict = connection.execute(
        sa.text("SELECT id::text FROM edge_devices WHERE device_key = :gateway_key"),
        projection,
    ).scalar_one_or_none()
    if conflict is not None:
        raise RuntimeError(f"Gateway key {gateway_key!r} is already owned by device {conflict}")
    connection.execute(_DEVICE_INSERT, projection)


def _account_projection(account: Mapping[str, Any]) -> dict[str, object]:
    account_id = _required_text(account.get("id"), "account id")
    role = _required_text(account.get("role"), f"role for {account_id}").upper()
    if role != "ENTERPRISE":
        raise RuntimeError(f"Account {account_id} is not an enterprise principal")
    source_kind = _required_text(account.get("source_kind"), f"source_kind for {account_id}")
    if source_kind == "real":
        classification = "official"
    elif source_kind == "mock":
        classification = "simulation"
    else:
        raise RuntimeError(
            f"Enterprise account {account_id} has unsupported source_kind {source_kind!r}"
        )
    simulation_run_id = _optional_text(account.get("mock_run_id"))
    if (classification == "simulation") != (simulation_run_id is not None):
        raise RuntimeError(
            f"Enterprise account {account_id} has inconsistent simulation-run ownership"
        )
    status = _required_text(account.get("status"), f"status for {account_id}").upper()
    if status not in {"ACTIVE", "INACTIVE"}:
        raise RuntimeError(f"Enterprise account {account_id} has unsupported status {status!r}")
    enterprise_uuid = _deterministic_uuid("enterprise", account_id)
    site_uuid = _deterministic_uuid("site", f"{enterprise_uuid}:primary")
    membership_uuid = _deterministic_uuid("membership", f"{enterprise_uuid}:{account_id}")
    gateway_key = _optional_text(account.get("gateway_id"))
    device_uuid = _deterministic_uuid("device", gateway_key) if gateway_key is not None else None
    manager_name = _required_text(account.get("manager_name"), f"manager_name for {account_id}")
    latitude, longitude = _validated_coordinates(account, account_id)
    return {
        "account_id": account_id,
        "enterprise_uuid": enterprise_uuid,
        "site_uuid": site_uuid,
        "membership_uuid": membership_uuid,
        "device_uuid": device_uuid,
        "counter_epoch_uuid": (
            _deterministic_uuid("counter-epoch", device_uuid) if device_uuid is not None else None
        ),
        "official_code": _required_text(
            account.get("enterprise_id"), f"enterprise_id for {account_id}"
        ),
        "enterprise_name": _required_text(
            account.get("enterprise_name"), f"enterprise_name for {account_id}"
        ),
        "manager_name": manager_name,
        "category": _optional_text(account.get("category")),
        "classification": classification,
        "lifecycle_state": "active" if status == "ACTIVE" else "inactive",
        "simulation_run_id": simulation_run_id,
        "barangay": _optional_text(account.get("barangay")),
        "address": _optional_text(account.get("address")),
        "building_capacity": _validated_capacity(account.get("building_capacity"), account_id),
        "latitude": latitude,
        "longitude": longitude,
        "location_source": _optional_text(account.get("location_source")),
        "location_confidence": _validated_location_confidence(account, account_id, latitude),
        "geocoded_address": _optional_text(account.get("geocoded_address")),
        "coordinates_updated_at": account.get("location_updated_at"),
        "gateway_key": gateway_key,
        "created_at": _required_datetime(account.get("created_at"), account_id, "created_at"),
        "updated_at": _required_datetime(account.get("updated_at"), account_id, "updated_at"),
    }


def _prove_cutover_invariants(connection: Connection) -> None:
    checks = {
        "enterprise principals without exactly one active membership": """
            SELECT count(*)
            FROM accounts a
            LEFT JOIN enterprise_memberships m
              ON m.account_id = a.id AND m.ended_at IS NULL
            WHERE a.role::text = 'ENTERPRISE' AND a.is_protected_system_account = false
            GROUP BY a.id HAVING count(m.id) <> 1
        """,
        "LGU/protected principals with topology": """
            SELECT count(*)
            FROM accounts a
            JOIN enterprise_memberships m ON m.account_id = a.id
            WHERE a.role::text <> 'ENTERPRISE' OR a.is_protected_system_account = true
        """,
        "enterprise principals without one effective primary site": """
            SELECT count(*)
            FROM accounts a
            JOIN enterprise_memberships m ON m.account_id = a.id AND m.ended_at IS NULL
            LEFT JOIN enterprise_sites s
              ON s.enterprise_id = m.enterprise_id
             AND s.classification = m.classification
             AND s.site_code = 'primary' AND s.effective_to IS NULL
            WHERE a.role::text = 'ENTERPRISE' AND a.is_protected_system_account = false
            GROUP BY a.id HAVING count(s.id) <> 1
        """,
        "topology/account lifecycle mismatches": """
            SELECT count(*)
            FROM accounts a
            JOIN enterprise_memberships m ON m.account_id = a.id AND m.ended_at IS NULL
            JOIN enterprises e ON e.id = m.enterprise_id
            WHERE (a.status::text = 'ACTIVE' AND e.lifecycle_state <> 'active')
               OR (a.status::text = 'INACTIVE' AND e.lifecycle_state <> 'inactive')
        """,
        "simulation ownership mismatches": """
            SELECT count(*)
            FROM enterprises
            WHERE (classification = 'official' AND simulation_run_id IS NOT NULL)
               OR (classification = 'simulation' AND simulation_run_id IS NULL)
        """,
    }
    for label, query in checks.items():
        rows = list(connection.execute(sa.text(query)).scalars())
        count = sum(int(value) for value in rows)
        if count:
            raise RuntimeError(f"Topology cutover proof failed: {count} {label}")

    op.create_check_constraint(
        "ck_enterprises_simulation_run_scope",
        "enterprises",
        "(classification = 'official' AND simulation_run_id IS NULL) OR "
        "(classification = 'simulation' AND simulation_run_id IS NOT NULL)",
    )


def _drop_superseded_account_columns() -> None:
    op.drop_index("ix_accounts_enterprise_id", table_name="accounts")
    op.drop_index("ix_accounts_mock_run_id", table_name="accounts")
    for column in _SUPERSEDED_ACCOUNT_COLUMNS:
        op.drop_column("accounts", column)


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


def _remember_unique(seen: dict[str, str], key: str, account_id: str, label: str) -> None:
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
        raise RuntimeError(f"Missing {label} during enterprise topology cutover")
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


_ENTERPRISE_UPSERT = sa.text(
    """
    INSERT INTO enterprises (
        id, official_code, name, category, classification, simulation_run_id,
        lifecycle_state, created_at, updated_at
    ) VALUES (
        CAST(:enterprise_uuid AS UUID), :official_code, :enterprise_name, :category,
        :classification, :simulation_run_id, :lifecycle_state, :created_at, :updated_at
    )
    ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        simulation_run_id = EXCLUDED.simulation_run_id,
        lifecycle_state = EXCLUDED.lifecycle_state,
        updated_at = EXCLUDED.updated_at
    """
)

_MEMBERSHIP_INSERT = sa.text(
    """
    INSERT INTO enterprise_memberships (
        id, enterprise_id, account_id, classification, membership_role,
        started_at, created_at
    ) VALUES (
        CAST(:membership_uuid AS UUID), CAST(:enterprise_uuid AS UUID), :account_id,
        :classification, 'manager', :created_at, :created_at
    )
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
        CAST(:site_uuid AS UUID), CAST(:enterprise_uuid AS UUID), :classification,
        'primary', :enterprise_name || ' Primary Site', :barangay, :address,
        'Asia/Manila', :building_capacity, :latitude, :longitude, :location_source,
        :location_confidence, :geocoded_address, :coordinates_updated_at,
        1, :created_at, :created_at, :updated_at
    )
    """
)

_SITE_UPDATE = sa.text(
    """
    UPDATE enterprise_sites
    SET name = :enterprise_name || ' Primary Site',
        barangay = :barangay,
        address = :address,
        building_capacity = :building_capacity,
        latitude = :latitude,
        longitude = :longitude,
        location_source = :location_source,
        location_confidence = :location_confidence,
        geocoded_address = :geocoded_address,
        coordinates_updated_at = :coordinates_updated_at,
        location_version = :next_location_version,
        updated_at = :updated_at
    WHERE id = CAST(:site_uuid AS UUID)
    """
)

_DEVICE_INSERT = sa.text(
    """
    INSERT INTO edge_devices (
        id, site_id, classification, device_key, display_name, lifecycle_state,
        counter_epoch, credential_version, paired_at, created_at, updated_at
    ) VALUES (
        CAST(:device_uuid AS UUID), CAST(:site_uuid AS UUID), :classification,
        :gateway_key, :gateway_key, 'active', CAST(:counter_epoch_uuid AS UUID),
        1, :created_at, :created_at, :updated_at
    )
    """
)
