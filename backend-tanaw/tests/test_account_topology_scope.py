from datetime import UTC, datetime
from typing import Any

import pytest

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.topology.account_scope import (
    AccountTopologyInvariantError,
    invalidate_site_coordinates,
    load_account_topology,
)
from app.features.topology.models import Enterprise, EnterpriseMembership, EnterpriseSite


class ScalarSequenceSession:
    def __init__(self, *responses: list[Any]) -> None:
        self.responses = iter(responses)

    async def scalars(self, _statement: object) -> list[Any]:
        return next(self.responses)


@pytest.mark.asyncio
async def test_enterprise_ownership_resolves_exactly_one_effective_scope() -> None:
    account, membership, enterprise, site = _scope_rows()
    db = ScalarSequenceSession([membership], [enterprise], [site], [], [])

    topology = await load_account_topology(db, account, evaluated_at=_now())  # type: ignore[arg-type]

    assert topology is not None
    assert topology.enterprise is enterprise
    assert topology.site is site
    assert topology.official_code == "ENT-001"
    assert topology.gateway_status == "Not Linked"


@pytest.mark.asyncio
async def test_enterprise_ownership_fails_closed_when_membership_is_missing() -> None:
    account, _, _, _ = _scope_rows()
    db = ScalarSequenceSession([])

    with pytest.raises(AccountTopologyInvariantError, match="exactly one effective membership"):
        await load_account_topology(db, account, evaluated_at=_now())  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_lgu_principal_is_forbidden_from_owning_enterprise_topology() -> None:
    account, membership, _, _ = _scope_rows()
    account.role = AccountRole.STAFF
    db = ScalarSequenceSession([membership])

    with pytest.raises(AccountTopologyInvariantError, match="Non-enterprise account"):
        await load_account_topology(db, account, evaluated_at=_now())  # type: ignore[arg-type]


def test_address_invalidation_is_atomic_and_keeps_stable_site_scope_start() -> None:
    _, _, _, site = _scope_rows()
    effective_from = site.effective_from
    site.latitude = 14.36
    site.longitude = 121.06
    site.location_source = "geocoder"
    site.location_confidence = 0.9
    site.geocoded_address = "Old Address"
    site.coordinates_updated_at = _now()
    site.location_version = 3

    invalidate_site_coordinates(site)

    assert site.location_version == 4
    assert site.effective_from == effective_from
    assert site.latitude is None
    assert site.longitude is None
    assert site.location_source is None
    assert site.location_confidence is None
    assert site.geocoded_address is None
    assert site.coordinates_updated_at is None


def _scope_rows() -> tuple[Account, EnterpriseMembership, Enterprise, EnterpriseSite]:
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
        building_capacity=100,
        effective_from=now,
    )
    return account, membership, enterprise, site


def _now() -> datetime:
    return datetime(2026, 7, 14, 12, tzinfo=UTC)
