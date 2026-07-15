from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.topology.account_scope import (
    AccountTopology,
    AccountTopologyInvariantError,
    invalidate_site_coordinates,
    load_account_topology,
)
from app.features.topology.models import (
    EdgeDevice,
    Enterprise,
    EnterpriseMembership,
    EnterpriseSite,
    SiteLocationVersion,
)


class ScalarSequenceSession:
    def __init__(self, *responses: list[Any]) -> None:
        self.responses = iter(responses)
        self.statements: list[object] = []

    async def scalars(self, statement: object) -> list[Any]:
        self.statements.append(statement)
        return next(self.responses)


@pytest.mark.asyncio
async def test_enterprise_ownership_resolves_exactly_one_effective_scope() -> None:
    account, membership, enterprise, site, location = _scope_rows()
    db = ScalarSequenceSession([membership], [enterprise], [site], [location], [], [], [])

    topology = await load_account_topology(db, account, evaluated_at=_now())  # type: ignore[arg-type]

    assert topology is not None
    assert topology.enterprise is enterprise
    assert topology.site is site
    assert topology.location is location
    assert topology.official_code == "ENT-001"
    assert topology.gateway_status == "Not Linked"
    location_statement = db.statements[3]
    rendered = str(location_statement)
    assert "site_location_versions.effective_from <=" in rendered
    assert "site_location_versions.effective_to >" in rendered


@pytest.mark.asyncio
async def test_enterprise_ownership_fails_closed_for_ambiguous_effective_location() -> None:
    account, membership, enterprise, site, first = _scope_rows()
    second = SiteLocationVersion(
        id="00000000-0000-0000-0000-000000000107",
        site_id=site.id,
        classification="official",
        version=2,
        barangay="Nueva",
        timezone_name="Asia/Manila",
        building_capacity=100,
        change_reason="invalid_overlap_fixture",
        effective_from=_now() - timedelta(hours=1),
    )
    db = ScalarSequenceSession([membership], [enterprise], [site], [first, second], [], [], [])

    with pytest.raises(AccountTopologyInvariantError, match="exactly one location version"):
        await load_account_topology(db, account, evaluated_at=_now())  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("pending_count", "oldest_age_seconds", "alert_active", "expected"),
    [
        (1, 10, False, "Connected"),
        (10, 10, False, "Sync Delayed"),
        (1, 300, False, "Sync Delayed"),
        (5, 30, True, "Sync Delayed"),
    ],
)
def test_gateway_status_uses_durable_backlog_thresholds(
    pending_count: int,
    oldest_age_seconds: int,
    alert_active: bool,
    expected: str,
) -> None:
    account, membership, enterprise, site, location = _scope_rows()
    now = _now()
    device = EdgeDevice(
        id="00000000-0000-0000-0000-000000000104",
        site_id=site.id,
        classification="official",
        device_key="gateway-1",
        display_name="Gateway One",
        device_role="telemetry_aggregator",
        lifecycle_state="active",
        counter_epoch="00000000-0000-0000-0000-000000000105",
    )
    live_state = SimpleNamespace(
        edge_device_id=device.id,
        offline_after_at=now + timedelta(minutes=5),
        freshness_expires_at=now + timedelta(seconds=90),
        service_state="healthy",
        pending_count=pending_count,
        oldest_pending_at=now - timedelta(seconds=oldest_age_seconds),
    )
    topology = AccountTopology(
        account=account,
        membership=membership,
        enterprise=enterprise,
        site=site,
        location=location,
        active_devices=(device,),
        live_state=live_state,  # type: ignore[arg-type]
        evaluated_at=now,
        sync_alert_state=(
            SimpleNamespace(status="active") if alert_active else None  # type: ignore[arg-type]
        ),
    )

    assert topology.gateway_status == expected


@pytest.mark.asyncio
async def test_enterprise_ownership_fails_closed_when_membership_is_missing() -> None:
    account, _, _, _, _ = _scope_rows()
    db = ScalarSequenceSession([])

    with pytest.raises(AccountTopologyInvariantError, match="exactly one effective membership"):
        await load_account_topology(db, account, evaluated_at=_now())  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_lgu_principal_is_forbidden_from_owning_enterprise_topology() -> None:
    account, membership, _, _, _ = _scope_rows()
    account.role = AccountRole.STAFF
    db = ScalarSequenceSession([membership])

    with pytest.raises(AccountTopologyInvariantError, match="Non-enterprise account"):
        await load_account_topology(db, account, evaluated_at=_now())  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_address_invalidation_appends_location_and_keeps_stable_site_identity() -> None:
    _, _, _, site, location = _scope_rows()
    location.version = 3
    location.latitude = 14.36
    location.longitude = 121.06
    location.location_source = "geocoder"
    location.location_confidence = 0.9
    location.geocoded_address = "Old Address"
    location.coordinates_confirmed_at = _now()
    db = MagicMock()
    db.flush = AsyncMock()

    successor = await invalidate_site_coordinates(
        db,
        site,
        location,
        barangay="Poblacion",
        address="New Address",
        building_capacity=100,
    )

    assert successor.version == 4
    assert successor.address == "New Address"
    assert successor.latitude is None
    assert successor.longitude is None
    assert location.effective_to is not None
    assert site.registered_at == _now()


def _scope_rows() -> tuple[
    Account, EnterpriseMembership, Enterprise, EnterpriseSite, SiteLocationVersion
]:
    now = _now()
    account = Account(
        id="account-1",
        email="manager@example.test",
        password_hash="not-used",
        role=AccountRole.ENTERPRISE,
        display_name="Enterprise Manager",
        title="Enterprise Manager",
        status=AccountStatus.ACTIVE,
        activated_at=now,
    )
    enterprise = Enterprise(
        id="00000000-0000-0000-0000-000000000101",
        official_code="ENT-001",
        name="Enterprise One",
        classification="official",
        lifecycle_state="active",
    )
    membership = EnterpriseMembership(
        id="00000000-0000-0000-0000-000000000102",
        enterprise_id=enterprise.id,
        account_id=account.id,
        classification="official",
        membership_role="manager",
        started_at=now,
    )
    site = EnterpriseSite(
        id="00000000-0000-0000-0000-000000000103",
        enterprise_id=enterprise.id,
        classification="official",
        site_code="primary",
        name="Enterprise One Primary Site",
        registered_at=now,
    )
    location = SiteLocationVersion(
        id="00000000-0000-0000-0000-000000000106",
        site_id=site.id,
        classification="official",
        version=1,
        barangay="Poblacion",
        address="Old Address",
        timezone_name="Asia/Manila",
        building_capacity=100,
        change_reason="registered",
        effective_from=now,
    )
    return account, membership, enterprise, site, location


def _now() -> datetime:
    return datetime(2026, 7, 14, 12, tzinfo=UTC)
