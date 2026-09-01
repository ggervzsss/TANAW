import json

from app.contracts.export import build_contract_bundle, serialize_contract_bundle
from app.features.realtime.contracts import RealtimeEventType


def test_contract_bundle_is_deterministic_and_contains_important_rest_apis() -> None:
    first = serialize_contract_bundle()
    second = serialize_contract_bundle()

    assert first == second
    contract = json.loads(first)
    paths = contract["openapi"]["paths"]
    assert "/auth/login" in paths
    assert "/auth/session" in paths
    assert "/operational/reports/intake" in paths
    assert "/operational/reports/final" in paths
    assert "/operational/desktop/telemetry" in paths
    assert "/operational/tickets" in paths


def test_realtime_contract_is_derived_from_backend_models() -> None:
    schemas = build_contract_bundle()["realtime"]["components"]["schemas"]

    assert schemas["RealtimeEventType"]["enum"] == [event.value for event in RealtimeEventType]
    assert set(schemas["RealtimeEnvelope"]["required"]) == {
        "event_id",
        "event_type",
        "occurred_at",
        "sequence",
    }
    assert set(schemas["RealtimeScope"]["properties"]) == {
        "enterprise_id",
        "enterprise_account_id",
        "recipient_account_id",
        "ticket_id",
        "report_id",
    }
