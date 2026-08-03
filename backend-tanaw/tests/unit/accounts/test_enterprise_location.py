import pytest
from pydantic import ValidationError

from app.features.accounts.location_validation import (
    barangay_for_location,
    barangay_matches_location,
    is_inside_san_pedro,
)
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


def test_manual_coordinates_must_match_the_selected_barangay() -> None:
    payload = EnterpriseAccountCreate.model_validate(enterprise_payload())
    detected = barangay_for_location(payload.latitude, payload.longitude)

    assert detected == "San Antonio"
    assert barangay_matches_location(payload.barangay, payload.latitude, payload.longitude)
    assert not barangay_matches_location("Poblacion", payload.latitude, payload.longitude)


def test_location_search_does_not_add_geocoding_persistence_fields() -> None:
    paths = app.openapi()["paths"]
    account_columns = Account.__table__.columns

    assert "/accounts/enterprises/location-suggestions" in paths
    assert "/accounts/enterprises/reverse-geocode" not in paths
    assert "location_source" not in account_columns
    assert "location_confidence" not in account_columns
    assert "geocoded_address" not in account_columns
