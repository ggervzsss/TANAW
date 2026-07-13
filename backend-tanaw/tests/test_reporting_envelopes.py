from uuid import UUID

import pytest
from pydantic import ValidationError

from app.features.reporting.envelopes import (
    ReportSubmissionCommand,
    canonical_payload_hash,
)

COMMAND_ID = UUID("018fbf1a-9bf0-7f5f-a70e-001122334455")


def test_report_command_accepts_exact_period_evidence_and_hashes_deterministically() -> None:
    command = ReportSubmissionCommand.model_validate(_command())

    assert command.payload.periodKey == "month:Asia/Manila:2026-06"
    assert canonical_payload_hash(command.payload) == canonical_payload_hash(
        command.payload.model_dump(mode="json")
    )
    assert len(canonical_payload_hash(command.payload)) == len("sha256:") + 64


def test_canonical_hash_normalizes_equivalent_timestamp_offsets() -> None:
    utc_command = ReportSubmissionCommand.model_validate(_command())
    local_payload = _command()
    local_payload["payload"]["sourceWindow"] = {
        "start": "2026-06-01T00:00:00+08:00",
        "end": "2026-07-01T00:00:00+08:00",
    }
    local_payload["payload"]["metrics"][0]["windowStart"] = "2026-06-01T00:00:00+08:00"
    local_payload["payload"]["metrics"][0]["windowEnd"] = "2026-07-01T00:00:00+08:00"
    local_command = ReportSubmissionCommand.model_validate(local_payload)

    assert canonical_payload_hash(utc_command.payload) == canonical_payload_hash(
        local_command.payload
    )


def test_report_command_rejects_display_period_and_wrong_window() -> None:
    payload = _command()
    payload["payload"]["periodKey"] = "June 2026"
    with pytest.raises(ValidationError, match="month:Asia/Manila:YYYY-MM"):
        ReportSubmissionCommand.model_validate(payload)

    payload = _command()
    payload["payload"]["sourceWindow"]["end"] = "2026-07-01T16:00:00Z"
    with pytest.raises(ValidationError, match="canonical reporting-period bounds"):
        ReportSubmissionCommand.model_validate(payload)


def test_report_command_rejects_fabricated_or_unbounded_extra_fields() -> None:
    payload = _command()
    payload["payload"]["preparedBy"] = "Client supplied actor"

    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        ReportSubmissionCommand.model_validate(payload)


def test_report_command_requires_an_optimistic_logical_version() -> None:
    payload = _command()
    del payload["expectedVersion"]

    with pytest.raises(ValidationError, match="Field required"):
        ReportSubmissionCommand.model_validate(payload)


def test_report_command_rejects_mismatched_source_watermark() -> None:
    payload = _command()
    payload["payload"]["sourceBatches"][0]["eventCount"] = 9

    with pytest.raises(ValidationError, match="sequence range must match eventCount"):
        ReportSubmissionCommand.model_validate(payload)


def test_unknown_metric_must_not_carry_a_value() -> None:
    payload = _command()
    payload["payload"]["metrics"][0]["quality"] = "unknown"

    with pytest.raises(ValidationError, match="must have a null value"):
        ReportSubmissionCommand.model_validate(payload)


def test_missing_coverage_evidence_remains_null_instead_of_becoming_a_full_period_gap() -> None:
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

    assert command.payload.coverage.monitoredSeconds is None
    assert command.payload.metrics[0].coverage.gapCount is None


def test_unrecorded_coverage_rejects_invented_zero_duration_and_gap() -> None:
    payload = _command()
    payload["payload"]["coverage"] = {
        "evidenceStatus": "not_recorded",
        "monitoredSeconds": 0,
        "expectedSeconds": 2_592_000,
        "gaps": [{"reason": "coverage_not_recorded", "durationSeconds": 2_592_000}],
    }

    with pytest.raises(ValidationError, match="cannot contain invented durations"):
        ReportSubmissionCommand.model_validate(payload)


def _command() -> dict:
    start = "2026-05-31T16:00:00Z"
    end = "2026-06-30T16:00:00Z"
    return {
        "contractVersion": 2,
        "commandId": str(COMMAND_ID),
        "idempotencyKey": "report:install-42:local-revision-0190",
        "occurredAt": "2026-07-01T00:02:10.123Z",
        "expectedVersion": 2,
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
                    "definition": "visitor_entries",
                    "definitionVersion": 1,
                    "value": 10,
                    "unit": "crossings",
                    "grain": "site",
                    "windowStart": start,
                    "windowEnd": end,
                    "timezone": "Asia/Manila",
                    "provenance": "camera_derived",
                    "quality": "confirmed",
                    "coverage": {
                        "evidenceStatus": "recorded",
                        "monitoredSeconds": 2592000,
                        "expectedSeconds": 2592000,
                        "gapCount": 0,
                    },
                }
            ],
            "demographicFacts": [],
            "coverage": {
                "evidenceStatus": "recorded",
                "monitoredSeconds": 2592000,
                "expectedSeconds": 2592000,
                "gaps": [],
            },
            "notes": None,
        },
    }
