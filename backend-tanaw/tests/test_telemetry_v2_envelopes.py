from copy import deepcopy
from typing import Any
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.features.telemetry.envelopes import (
    EpochStartCommand,
    TelemetryCommand,
    canonical_payload_hash,
)


def test_epoch_command_requires_exact_device_epoch_idempotency_key() -> None:
    payload = _epoch_command()
    command = EpochStartCommand.model_validate(payload)

    assert command.expectedVersion == 0
    invalid = deepcopy(payload)
    invalid["idempotencyKey"] = "telemetry-epoch:another-device:another-epoch"
    with pytest.raises(ValidationError, match="identify the device and counter epoch"):
        EpochStartCommand.model_validate(invalid)


def test_telemetry_contract_rejects_unsupported_aliases_and_client_scope() -> None:
    payload = _telemetry_command()
    payload["payload"]["metrics"][0]["definition"] = "entries"
    with pytest.raises(ValidationError, match="not in the v2 catalog"):
        TelemetryCommand.model_validate(payload)

    payload = _telemetry_command()
    payload["payload"]["classification"] = "official"
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        TelemetryCommand.model_validate(payload)


def test_telemetry_contract_rejects_mixed_windows_and_fabricated_coverage() -> None:
    payload = _telemetry_command()
    second = deepcopy(payload["payload"]["metrics"][0])
    second["definition"] = "visitor_exits"
    second["windowStart"] = "2026-07-13T08:14:04Z"
    second["coverage"]["expectedSeconds"] = 59
    second["coverage"]["monitoredSeconds"] = 59
    payload["payload"]["metrics"].append(second)
    with pytest.raises(ValidationError, match="cannot mix metric windows"):
        TelemetryCommand.model_validate(payload)

    payload = _telemetry_command()
    payload["payload"]["metrics"][0]["coverage"] = {
        "evidenceStatus": "not_recorded",
        "monitoredSeconds": 0,
        "expectedSeconds": None,
        "gapCount": None,
    }
    with pytest.raises(ValidationError, match="cannot contain invented values"):
        TelemetryCommand.model_validate(payload)


def test_canonical_hash_normalizes_utc_and_integral_float() -> None:
    first = canonical_payload_hash({"observedAt": "2026-07-13T08:15:03Z", "value": 1})
    second = canonical_payload_hash({"value": 1.0, "observedAt": "2026-07-13T08:15:03Z"})

    assert first == second


def _epoch_command() -> dict[str, Any]:
    device_id = uuid4()
    counter_epoch = uuid4()
    return {
        "contractVersion": 2,
        "commandId": str(uuid4()),
        "idempotencyKey": f"telemetry-epoch:{device_id}:{counter_epoch}",
        "occurredAt": "2026-07-13T08:15:00Z",
        "expectedVersion": 0,
        "payload": {
            "deviceId": str(device_id),
            "counterEpoch": str(counter_epoch),
            "expectedPreviousEpoch": None,
        },
    }


def _telemetry_command() -> dict[str, Any]:
    device_id = uuid4()
    camera_id = uuid4()
    counter_epoch = uuid4()
    return {
        "contractVersion": 2,
        "commandId": str(uuid4()),
        "idempotencyKey": f"telemetry:{device_id}:{counter_epoch}:1",
        "occurredAt": "2026-07-13T08:15:03Z",
        "expectedVersion": 1,
        "payload": {
            "deviceId": str(device_id),
            "counterEpoch": str(counter_epoch),
            "epochGeneration": 1,
            "sequence": 1,
            "observedAt": "2026-07-13T08:15:03Z",
            "metrics": [
                {
                    "definition": "visitor_entries",
                    "definitionVersion": 1,
                    "value": 3,
                    "unit": "crossings",
                    "grain": "site",
                    "cameraId": None,
                    "windowStart": "2026-07-13T08:14:03Z",
                    "windowEnd": "2026-07-13T08:15:03Z",
                    "timezone": "Asia/Manila",
                    "provenance": "camera_derived",
                    "quality": "confirmed",
                    "coverage": {
                        "evidenceStatus": "recorded",
                        "monitoredSeconds": 60,
                        "expectedSeconds": 60,
                        "gapCount": 0,
                    },
                }
            ],
            "deviceHealth": {
                "service": "healthy",
                "cameraStates": [{"cameraId": str(camera_id), "state": "streaming"}],
                "analyticsFps": 12.5,
            },
            "syncHealth": {
                "evidenceStatus": "recorded",
                "pendingCount": 0,
                "oldestPendingAt": None,
                "lastAcknowledgedAt": "2026-07-13T08:15:00Z",
                "lastFailureAt": None,
                "lastFailureClass": None,
            },
        },
    }
