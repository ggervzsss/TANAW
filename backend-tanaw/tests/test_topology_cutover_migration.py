import runpy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import pytest
from sqlalchemy import Table

from app.db.base import Account, Base, MockDataRunAccount


def test_cutover_is_chained_irreversible_and_removes_exact_account_responsibilities() -> None:
    migration = _migration()

    assert migration["revision"] == "20260714_0028"
    assert migration["down_revision"] == "20260713_0027"
    with pytest.raises(RuntimeError, match="backup"):
        migration["downgrade"]()

    superseded = set(migration["_SUPERSEDED_ACCOUNT_COLUMNS"])
    assert superseded == {
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
    }
    assert superseded.isdisjoint(Account.__table__.c.keys())
    assert cast(Table, MockDataRunAccount.__table__).name in Base.metadata.tables


def test_cutover_projection_is_deterministic_and_fail_closed() -> None:
    migration = _migration()
    project = migration["_account_projection"]
    account = _legacy_enterprise_account()

    first = project(account)
    second = project(account)

    assert first == second
    assert first["classification"] == "official"
    assert first["simulation_run_id"] is None
    assert first["manager_name"] == "Alicia Manager"

    account["manager_name"] = None
    with pytest.raises(RuntimeError, match="manager_name"):
        project(account)

    account = _legacy_enterprise_account()
    account["source_kind"] = "mock"
    with pytest.raises(RuntimeError, match="simulation-run ownership"):
        project(account)


def test_address_change_increments_version_and_clears_all_coordinate_provenance() -> None:
    migration = _migration()
    reconcile = migration["_site_reconciliation_values"]
    projection = migration["_account_projection"](_legacy_enterprise_account())
    site = {
        "address": "Old Address",
        "barangay": projection["barangay"],
        "latitude": 14.34,
        "longitude": 121.05,
        "location_source": "geocoder",
        "location_confidence": 0.9,
        "geocoded_address": "Old Geocoded Address",
        "coordinates_updated_at": datetime(2026, 1, 1, tzinfo=UTC),
        "location_version": 4,
    }

    values = reconcile(site, projection)

    assert values["next_location_version"] == 5
    for field in (
        "latitude",
        "longitude",
        "location_source",
        "location_confidence",
        "geocoded_address",
        "coordinates_updated_at",
    ):
        assert values[field] is None


def _migration() -> dict[str, Any]:
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "20260714_0028_topology_authority_cutover.py"
    )
    return runpy.run_path(str(path))


def _legacy_enterprise_account() -> dict[str, object]:
    now = datetime(2026, 7, 14, tzinfo=UTC)
    return {
        "id": "f7c7206b-07e0-4999-8419-8fc9006b09cf",
        "role": "ENTERPRISE",
        "status": "ACTIVE",
        "source_kind": "real",
        "mock_run_id": None,
        "enterprise_id": "sample_001@tanaw.sanpedro",
        "enterprise_name": "Sample Enterprise",
        "manager_name": "Alicia Manager",
        "category": "business",
        "barangay": "Poblacion",
        "address": "New Address, San Pedro, Laguna 4023",
        "building_capacity": 250,
        "latitude": 14.36,
        "longitude": 121.06,
        "location_source": "geocoder",
        "location_confidence": 0.91,
        "geocoded_address": "New Address, San Pedro, Laguna 4023",
        "location_updated_at": now,
        "gateway_id": "GW-001",
        "created_at": now,
        "updated_at": now,
    }
