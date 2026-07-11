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
    account = enterprise_account(building_capacity=425)

    assert to_auth_user(account).buildingCapacity == 425
    assert to_account_summary(account).buildingCapacity == 425


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


def enterprise_account(*, building_capacity: int) -> Account:
    return Account(
        id="account-1",
        email="enterprise@example.com",
        password_hash="hash",
        role=AccountRole.ENTERPRISE,
        display_name="Acme Mall",
        title="Enterprise",
        status=AccountStatus.ACTIVE,
        enterprise_id="ent-001",
        enterprise_name="Acme Mall",
        category="business",
        manager_name="Alex Santos",
        barangay="Poblacion",
        address="123 Main Street, San Pedro, Laguna 4023",
        building_capacity=building_capacity,
        activated_at=datetime(2026, 7, 3, tzinfo=UTC),
        created_at=datetime(2026, 7, 3, tzinfo=UTC),
    )
