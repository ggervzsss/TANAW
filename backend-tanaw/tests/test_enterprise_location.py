import pytest
from pydantic import ValidationError

from app.features.accounts.location_validation import is_inside_san_pedro
from app.features.accounts.models import Account
from app.features.accounts.schemas import EnterpriseAccountCreate
from app.main import app


def enterprise_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "enterpriseName": "Crismor Test Enterprise",
        "category": "business",
        "managerName": "Alex Santos",
        "email": "enterprise@example.com",
        "barangay": "San Antonio",
        "address": "Crismor Subdivision, B2 L22 Sapphire Street",
        "latitude": 14.3525904,
        "longitude": 121.0314825,
    }
    payload.update(overrides)
    return payload


def test_enterprise_creation_requires_manual_coordinates() -> None:
    payload = enterprise_payload()
    payload.pop("latitude")
    payload.pop("longitude")

    with pytest.raises(ValidationError):
        EnterpriseAccountCreate.model_validate(payload)


def test_manual_coordinates_inside_san_pedro_are_accepted() -> None:
    payload = EnterpriseAccountCreate.model_validate(enterprise_payload())

    assert is_inside_san_pedro(payload.latitude, payload.longitude)
    assert not is_inside_san_pedro(14.5995, 120.9842)


def test_geocoding_api_and_persistence_fields_are_removed() -> None:
    paths = app.openapi()["paths"]
    account_columns = Account.__table__.columns

    assert "/accounts/enterprises/geocode" not in paths
    assert "/accounts/enterprises/reverse-geocode" not in paths
    assert "location_source" not in account_columns
    assert "location_confidence" not in account_columns
    assert "geocoded_address" not in account_columns
