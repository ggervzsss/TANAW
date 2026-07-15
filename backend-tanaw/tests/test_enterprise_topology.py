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
