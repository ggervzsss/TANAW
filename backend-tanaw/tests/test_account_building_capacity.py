from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.schemas import (
    BuildingCapacityUpdate,
    EnterpriseAccountCreate,
    EnterpriseAccountUpdate,
)
from app.features.accounts.service import to_account_summary, to_auth_user
from app.features.topology.account_scope import AccountTopology
from app.features.topology.models import Enterprise, EnterpriseMembership, EnterpriseSite


def test_enterprise_account_create_defaults_building_capacity() -> None:
    payload = EnterpriseAccountCreate.model_validate(enterprise_create_payload())

    assert payload.buildingCapacity == 100


def test_enterprise_account_payloads_validate_building_capacity() -> None:
    with pytest.raises(ValidationError):
        EnterpriseAccountCreate.model_validate(enterprise_create_payload(buildingCapacity=0))

    update_payload = EnterpriseAccountUpdate.model_validate(
        enterprise_update_payload(buildingCapacity=250)
    )

    assert update_payload.buildingCapacity == 250

    with pytest.raises(ValidationError):
        BuildingCapacityUpdate(buildingCapacity=100_001)


def test_account_serializers_include_building_capacity() -> None:
    topology = enterprise_topology(building_capacity=425)

    assert to_auth_user(topology.account, topology).buildingCapacity == 425
    assert to_account_summary(topology.account, topology=topology).buildingCapacity == 425


def enterprise_create_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "enterpriseName": "Acme Mall",
        "category": "business",
        "managerName": "Alex Santos",
        "email": "enterprise@example.com",
        "contactNumber": "+639171234567",
        "barangay": "Poblacion",
        "address": "123 Main Street",
    }
    payload.update(overrides)
    return payload


def enterprise_update_payload(**overrides: object) -> dict[str, object]:
    payload = enterprise_create_payload()
    payload["status"] = "active"
    payload.update(overrides)
    return payload


def enterprise_topology(*, building_capacity: int) -> AccountTopology:
    observed_at = datetime(2026, 7, 3, tzinfo=UTC)
    account = Account(
        id="account-1",
        email="enterprise@example.com",
        password_hash="hash",
        role=AccountRole.ENTERPRISE,
        display_name="Alex Santos",
        title="Enterprise",
        status=AccountStatus.ACTIVE,
        activated_at=observed_at,
        created_at=observed_at,
    )
    enterprise = Enterprise(
        id="00000000-0000-0000-0000-000000000001",
        official_code="ent-001",
        name="Acme Mall",
        category="business",
        classification="official",
        lifecycle_state="active",
    )
    membership = EnterpriseMembership(
        id="00000000-0000-0000-0000-000000000002",
        enterprise_id=enterprise.id,
        account_id=account.id,
        classification="official",
        membership_role="manager",
        started_at=observed_at,
    )
    site = EnterpriseSite(
        id="00000000-0000-0000-0000-000000000003",
        enterprise_id=enterprise.id,
        classification="official",
        site_code="primary",
        name="Acme Mall Primary Site",
        barangay="Poblacion",
        address="123 Main Street, San Pedro, Laguna 4023",
        building_capacity=building_capacity,
        effective_from=observed_at,
    )
    return AccountTopology(
        account=account,
        membership=membership,
        enterprise=enterprise,
        site=site,
        active_devices=(),
        live_state=None,
        evaluated_at=observed_at,
    )
