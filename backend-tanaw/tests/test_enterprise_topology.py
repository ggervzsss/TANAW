import runpy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import Engine, create_engine, event
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.base import (
    Account,
    AccountRole,
    AccountStatus,
    Base,
    Camera,
    EdgeDevice,
    Enterprise,
    EnterpriseMembership,
    EnterpriseSite,
    SiteLocationVersion,
)


@pytest.fixture
def sqlite_engine() -> Engine:
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection: Any, _connection_record: Any) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    return engine


def test_topology_uses_native_postgres_uuid_and_sqlite_can_create_schema(
    sqlite_engine: Engine,
) -> None:
    assert Enterprise.__table__.c.id.type.compile(dialect=postgresql.dialect()) == "UUID"
    assert (
        EnterpriseSite.__table__.c.enterprise_id.type.compile(dialect=postgresql.dialect())
        == "UUID"
    )
    assert (
        EnterpriseMembership.__table__.c.account_id.type.compile(dialect=postgresql.dialect())
        == "UUID"
    )

    assert {
        "enterprises",
        "enterprise_memberships",
        "enterprise_sites",
        "edge_devices",
        "cameras",
    }.issubset(Base.metadata.tables)


def test_site_constraints_reject_invalid_capacity_and_unpaired_coordinates(
    sqlite_engine: Engine,
) -> None:
    enterprise_id = _insert_enterprise(sqlite_engine, "official", "ENT-CHECK")

    with Session(sqlite_engine) as session:
        site = EnterpriseSite(
            enterprise_id=enterprise_id,
            classification="official",
            site_code="location-check",
            name="Location check",
        )
        session.add(site)
        session.commit()
        session.add(
            SiteLocationVersion(
                site_id=site.id,
                classification="official",
                version=1,
                timezone_name="Asia/Manila",
                building_capacity=0,
                change_reason="test",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
        session.rollback()

        session.add(
            SiteLocationVersion(
                site_id=site.id,
                classification="official",
                version=2,
                timezone_name="Asia/Manila",
                building_capacity=100,
                latitude=14.36,
                longitude=None,
                change_reason="test",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_active_membership_is_unique_per_account(sqlite_engine: Engine) -> None:
    account_id = _insert_account(sqlite_engine)
    first_enterprise_id = _insert_enterprise(sqlite_engine, "official", "ENT-ONE")
    second_enterprise_id = _insert_enterprise(sqlite_engine, "official", "ENT-TWO")

    with Session(sqlite_engine) as session:
        session.add(
            EnterpriseMembership(
                enterprise_id=first_enterprise_id,
                account_id=account_id,
                classification="official",
                membership_role="manager",
            )
        )
        session.commit()

        session.add(
            EnterpriseMembership(
                enterprise_id=second_enterprise_id,
                account_id=account_id,
                classification="official",
                membership_role="manager",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_composite_foreign_keys_reject_cross_classification_topology(
    sqlite_engine: Engine,
) -> None:
    enterprise_id = _insert_enterprise(sqlite_engine, "official", "ENT-OFFICIAL")

    with Session(sqlite_engine) as session:
        session.add(
            EnterpriseSite(
                enterprise_id=enterprise_id,
                classification="simulation",
                site_code="wrong-classification",
                name="Invalid simulation site",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_camera_identity_is_scoped_to_one_device(sqlite_engine: Engine) -> None:
    enterprise_id = _insert_enterprise(sqlite_engine, "official", "ENT-CAMERA")
    with Session(sqlite_engine) as session:
        site = EnterpriseSite(
            enterprise_id=enterprise_id,
            classification="official",
            site_code="primary",
            name="Camera site",
        )
        session.add(site)
        session.commit()

        device = EdgeDevice(
            site_id=site.id,
            classification="official",
            device_key="GW-CAMERA",
            display_name="Gateway camera",
        )
        session.add(device)
        session.commit()

        session.add(
            Camera(
                site_id=site.id,
                edge_device_id=device.id,
                classification="official",
                camera_key="front-door",
                display_name="Front door",
            )
        )
        session.commit()

        session.add(
            Camera(
                site_id=site.id,
                edge_device_id=device.id,
                classification="official",
                camera_key="front-door",
                display_name="Duplicate front door",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()


def test_topology_backfill_mapping_is_deterministic_and_classifies_server_data() -> None:
    migration = _topology_migration()
    build_rows = migration["_topology_rows_for_account"]
    now = datetime(2026, 7, 13, tzinfo=UTC)
    account = {
        "id": "f7c7206b-07e0-4999-8419-8fc9006b09cf",
        "enterprise_id": "ENT-001",
        "enterprise_name": "Sample Enterprise",
        "display_name": "Manager",
        "category": "Retail",
        "barangay": "Poblacion",
        "address": "1 Sample Street",
        "latitude": 14.36,
        "longitude": 121.06,
        "location_source": "geocoder",
        "location_confidence": 0.91,
        "geocoded_address": "1 Sample Street, San Pedro",
        "location_updated_at": now,
        "gateway_id": "GW-001",
        "building_capacity": 250,
        "source_kind": "real",
        "status": "ACTIVE",
        "created_at": now,
        "updated_at": now,
    }

    first = build_rows(account)
    second = build_rows(account)

    assert first == second
    assert first.enterprise["classification"] == "official"
    assert first.site["timezone_name"] == "Asia/Manila"
    assert first.membership["account_id"] == account["id"]
    assert first.device is not None
    assert first.device["device_key"] == "GW-001"
    assert first.device["counter_epoch"] != first.device["id"]


def test_topology_backfill_refuses_unknown_classification_and_duplicate_devices() -> None:
    migration = _topology_migration()
    build_rows = migration["_topology_rows_for_account"]
    validate_unique = migration["_validate_unique_business_keys"]
    now = datetime(2026, 7, 13, tzinfo=UTC)

    invalid = _backfill_account(now, account_id=str(uuid4()), source_kind="hybrid")
    with pytest.raises(RuntimeError, match="cannot be guessed"):
        build_rows(invalid)

    first = build_rows(_backfill_account(now, account_id=str(uuid4()), gateway_id="GW-DUP"))
    second = build_rows(_backfill_account(now, account_id=str(uuid4()), gateway_id="GW-DUP"))
    with pytest.raises(RuntimeError, match="Duplicate edge device key"):
        validate_unique([first, second])


def test_topology_migration_is_chained_and_backfill_inserts_are_idempotent() -> None:
    migration = _topology_migration()

    assert migration["revision"] == "20260713_0020"
    assert migration["down_revision"] == "20260712_0019"
    for statement_name in (
        "_ENTERPRISE_INSERT",
        "_MEMBERSHIP_INSERT",
        "_SITE_INSERT",
        "_DEVICE_INSERT",
    ):
        assert "ON CONFLICT (id) DO NOTHING" in str(migration[statement_name])


def _insert_account(engine: Engine) -> str:
    account_id = str(uuid4())
    with Session(engine) as session:
        session.add(
            Account(
                id=account_id,
                email=f"{account_id}@example.test",
                password_hash="hashed",
                role=AccountRole.ENTERPRISE,
                display_name="Topology manager",
                title="Manager",
                status=AccountStatus.ACTIVE,
            )
        )
        session.commit()
    return account_id


def _insert_enterprise(engine: Engine, classification: str, code: str) -> str:
    with Session(engine) as session:
        enterprise = Enterprise(
            official_code=code,
            name=code,
            classification=classification,
            lifecycle_state="active",
        )
        session.add(enterprise)
        session.commit()
        return enterprise.id


def _topology_migration() -> dict[str, Any]:
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "20260713_0020_normalized_enterprise_topology.py"
    )
    return runpy.run_path(str(migration_path))


def _backfill_account(
    now: datetime,
    *,
    account_id: str,
    source_kind: str = "real",
    gateway_id: str | None = None,
) -> dict[str, object]:
    return {
        "id": account_id,
        "enterprise_id": account_id,
        "enterprise_name": f"Enterprise {account_id}",
        "display_name": "Manager",
        "category": None,
        "barangay": None,
        "address": None,
        "latitude": None,
        "longitude": None,
        "location_source": None,
        "location_confidence": None,
        "geocoded_address": None,
        "location_updated_at": None,
        "gateway_id": gateway_id,
        "building_capacity": 100,
        "source_kind": source_kind,
        "status": "ACTIVE",
        "created_at": now,
        "updated_at": now,
    }
