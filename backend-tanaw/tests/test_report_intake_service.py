from copy import deepcopy

import pytest

from app.features.reporting.envelopes import ReportSubmissionCommand
from app.features.reporting.service import (
    ReportIntakeError,
    _has_incomplete_evidence,
    _validate_metrics,
)


def test_intake_accepts_only_catalog_metric_unit_and_grain() -> None:
    command = ReportSubmissionCommand.model_validate(_command())

    _validate_metrics(command)

    invalid = _command()
    invalid["payload"]["metrics"][0]["unit"] = "people"
    invalid_command = ReportSubmissionCommand.model_validate(invalid)
    with pytest.raises(ReportIntakeError, match="canonical unit and grain"):
        _validate_metrics(invalid_command)


def test_intake_rejects_duplicate_metric_identity() -> None:
    payload = _command()
    payload["payload"]["metrics"].append(deepcopy(payload["payload"]["metrics"][0]))
    command = ReportSubmissionCommand.model_validate(payload)

    with pytest.raises(ReportIntakeError, match="duplicated"):
        _validate_metrics(command)


def test_unrecorded_coverage_blocks_acceptance_without_inventing_values() -> None:
    payload = _command()
    payload["payload"]["coverage"] = {
        "evidenceStatus": "not_recorded",
        "monitoredSeconds": None,
        "expectedSeconds": None,
        "gaps": [],
    }
    payload["payload"]["metrics"][0]["coverage"] = {
        "evidenceStatus": "not_recorded",
        "monitoredSeconds": None,
        "expectedSeconds": None,
        "gapCount": None,
    }
    command = ReportSubmissionCommand.model_validate(payload)

    assert _has_incomplete_evidence(command) is True


def _command() -> dict:
    start = "2026-05-31T16:00:00Z"
    end = "2026-06-30T16:00:00Z"
    return {
        "contractVersion": 2,
        "commandId": "018fbf1a-9bf0-7f5f-a70e-001122334455",
        "idempotencyKey": "report:install-42:local-revision-0190",
        "occurredAt": "2026-07-01T00:02:10.123Z",
        "expectedVersion": 0,
        "payload": {
            "periodKey": "month:Asia/Manila:2026-06",
            "localRevisionId": "local-revision-0190",
            "sourceWindow": {"start": start, "end": end},
            "sourceBatches": [
                {
                    "batchId": "018fbf1a-9bf0-7f5f-a70e-001122334466",
                    "cameraId": "018fbf1a-9bf0-7f5f-a70e-001122334477",
                    "eventCount": 10,
                    "eventSequenceStart": 1000,
                    "eventSequenceEndExclusive": 1010,
                    "aggregateHash": f"sha256:{'a' * 64}",
                }
            ],
            "metrics": [
                {
                    "definition": "entries",
                    "definitionVersion": 1,
                    "value": 10,
                    "unit": "events",
                    "grain": "site",
                    "windowStart": start,
                    "windowEnd": end,
                    "timezone": "Asia/Manila",
                    "provenance": "camera_derived",
                    "quality": "confirmed",
                    "coverage": {
                        "evidenceStatus": "recorded",
                        "monitoredSeconds": 2_592_000,
                        "expectedSeconds": 2_592_000,
                        "gapCount": 0,
                    },
                }
            ],
            "demographicFacts": [],
            "coverage": {
                "evidenceStatus": "recorded",
                "monitoredSeconds": 2_592_000,
                "expectedSeconds": 2_592_000,
                "gaps": [],
            },
            "notes": None,
        },
    }
