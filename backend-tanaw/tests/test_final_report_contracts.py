from copy import deepcopy

import pytest
from pydantic import ValidationError

from app.features.final_reports.envelopes import FinalizeReportsCommand


def test_finalization_sources_require_unique_canonical_order() -> None:
    payload = _command()
    payload["payload"]["reportRevisionIds"] = [
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]
    with pytest.raises(ValidationError, match="canonical UUID order"):
        FinalizeReportsCommand.model_validate(payload)

    payload["payload"]["reportRevisionIds"] = [
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ]
    with pytest.raises(ValidationError, match="must be unique"):
        FinalizeReportsCommand.model_validate(payload)


def test_scope_shape_and_correction_target_are_explicit() -> None:
    barangay = _command()
    barangay["payload"]["scope"] = {"type": "barangay", "barangay": "  San   Jose "}
    command = FinalizeReportsCommand.model_validate(barangay)
    assert command.payload.scope.barangay == "San Jose"

    citywide = _command()
    citywide["payload"]["scope"] = {"type": "citywide", "barangay": "San Jose"}
    with pytest.raises(ValidationError, match="Only barangay"):
        FinalizeReportsCommand.model_validate(citywide)

    correction = deepcopy(_command())
    correction["expectedVersion"] = 1
    with pytest.raises(ValidationError, match="targetFinalizationId"):
        FinalizeReportsCommand.model_validate(correction)
    correction["payload"]["targetFinalizationId"] = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    with pytest.raises(ValidationError, match="audit reason"):
        FinalizeReportsCommand.model_validate(correction)


def _command() -> dict:
    return {
        "contractVersion": 2,
        "commandId": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        "idempotencyKey": "final-report:test:create-1",
        "occurredAt": "2026-07-13T08:00:00Z",
        "expectedVersion": 0,
        "payload": {
            "targetFinalizationId": None,
            "reportingPeriodId": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            "scope": {"type": "enterprise_selection", "barangay": None},
            "reportRevisionIds": ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
            "reason": None,
        },
    }
