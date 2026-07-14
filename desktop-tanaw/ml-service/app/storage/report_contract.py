from __future__ import annotations

import hashlib
import json
import sqlite3
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from app.storage.reporting_periods import monthly_period_from_id

REPORT_OUTBOX_ENDPOINT = "/operational/desktop/report-submissions/v2"
REPORT_OUTBOX_CONTRACT_VERSION = 2
MAX_DEMOGRAPHIC_COUNT = 2_147_483_647


def canonical_json(value: Any) -> str:
    try:
        return json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError) as exc:
        raise ValueError("Report payload must contain only finite JSON values.") from exc


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def canonical_payload_hash(value: Any) -> str:
    return f"sha256:{canonical_hash(value)}"


def central_report_idempotency_key(report_id: str, revision_id: str) -> str:
    safe_report_id = "".join(
        character if character.isalnum() or character in "._-" else "_" for character in report_id
    )
    return f"report:{safe_report_id[:100] or 'local'}:{revision_id}"


def local_camera_key(
    camera_id: Any,
    camera_name: Any,
    central_camera_id: Any = None,
) -> str:
    if central_camera_id is not None:
        try:
            return str(UUID(str(central_camera_id)))
        except ValueError as exc:
            raise ValueError("Central camera ID must be a valid UUID.") from exc
    normalized_name = str(camera_name or "unknown").strip().lower()
    suffix_source = f"{camera_id}:{normalized_name}"
    suffix = hashlib.sha256(suffix_source.encode("utf-8")).hexdigest()[:16]
    return f"unassigned:{suffix}"


def allocate_camera_event_sequences(
    connection: sqlite3.Connection, camera_key: str, count: int = 1
) -> int:
    if count < 1:
        raise ValueError("Camera event sequence allocation count must be positive.")
    row = connection.execute(
        """
        insert into local_camera_event_sequences (camera_key, next_sequence)
        values (?, ?)
        on conflict(camera_key) do update set
            next_sequence = local_camera_event_sequences.next_sequence + excluded.next_sequence
        returning next_sequence - ? as sequence_start
        """,
        (camera_key, count, count),
    ).fetchone()
    return int(row["sequence_start"])


def build_revision_document(**values: Any) -> dict[str, Any]:
    return _revision_document(**values)


def _revision_document(
    *,
    revision_id: str,
    report_id: str,
    revision_number: int,
    command_id: str,
    idempotency_key: str,
    expected_version: int,
    period_id: str | None,
    period_label: str,
    submitted_at: str,
    entries: int,
    exits: int,
    peak_occupancy: int,
    unique_count: int,
    notes: Any,
    payload: dict[str, Any],
    source_kind: str,
    mock_run_id: Any,
    source_batches: list[dict[str, Any]],
    coverage_evidence: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if period_id is None:
        source_window = {"start": submitted_at, "end": submitted_at}
    else:
        period = monthly_period_from_id(period_id)
        if period is None:
            raise ValueError(f"Invalid canonical reporting period: {period_id}")
        source_window = {
            "start": _utc_contract_timestamp(period.starts_at_utc),
            "end": _utc_contract_timestamp(period.ends_at_utc),
        }
    local_coverage = coverage_evidence or {
        "evidenceStatus": "not_recorded",
        "monitoredSeconds": None,
        "expectedSeconds": None,
        "coverageRatio": None,
        "gapCount": None,
        "gaps": [],
        "warnings": ["No monitoring-session evidence was recorded for this reporting period."],
    }
    coverage = _contract_coverage(local_coverage)
    metric_coverage: dict[str, Any] = {
        "evidenceStatus": coverage.get("evidenceStatus", "not_recorded"),
        "monitoredSeconds": coverage.get("monitoredSeconds"),
        "expectedSeconds": coverage.get("expectedSeconds"),
        "gapCount": (
            len(coverage.get("gaps", [])) if coverage.get("evidenceStatus") == "recorded" else None
        ),
    }
    metric_provenance = "system_derived" if source_kind == "mock" else "camera_derived"
    metrics = [
        _metric_command(
            "entries",
            entries,
            "events",
            source_window,
            metric_provenance,
            metric_coverage,
        ),
        _metric_command(
            "exits",
            exits,
            "events",
            source_window,
            metric_provenance,
            metric_coverage,
        ),
        _metric_command(
            "peak_occupancy",
            peak_occupancy,
            "people-estimate",
            source_window,
            metric_provenance,
            metric_coverage,
        ),
        _metric_command(
            "unique_visitor_estimate",
            unique_count,
            "visitor-estimate",
            source_window,
            metric_provenance,
            metric_coverage,
        ),
    ]
    return {
        "contractVersion": 2,
        "commandId": command_id,
        "idempotencyKey": idempotency_key,
        "occurredAt": _utc_contract_timestamp(submitted_at),
        "expectedVersion": expected_version,
        "payload": {
            "periodKey": period_id,
            "localRevisionId": revision_id,
            "sourceWindow": source_window,
            "sourceBatches": source_batches,
            "metrics": metrics,
            "demographicFacts": _demographic_facts(payload),
            "coverage": coverage,
            "notes": notes,
        },
    }


def _contract_coverage(coverage: dict[str, Any]) -> dict[str, Any]:
    if coverage.get("evidenceStatus") != "recorded":
        return {
            "evidenceStatus": "not_recorded",
            "monitoredSeconds": None,
            "expectedSeconds": None,
            "gaps": [],
        }

    source_gaps = coverage.get("gaps")
    normalized_gaps: list[tuple[str, int]] = []
    if isinstance(source_gaps, list):
        for source_gap in source_gaps:
            if not isinstance(source_gap, dict):
                continue
            duration = source_gap.get("durationSeconds")
            if not isinstance(duration, (int, float)) or duration <= 0:
                continue
            reason = str(source_gap.get("reason") or "monitoring_gap").strip()[:120]
            normalized_gaps.append((reason or "monitoring_gap", max(1, round(duration))))

    raw_expected = coverage.get("expectedSeconds")
    expected = max(
        len(normalized_gaps),
        1,
        round(raw_expected) if isinstance(raw_expected, (int, float)) else 1,
    )
    remaining = expected
    contract_gaps: list[dict[str, Any]] = []
    for index, (reason, requested_duration) in enumerate(normalized_gaps):
        remaining_gaps = len(normalized_gaps) - index - 1
        duration = min(requested_duration, max(1, remaining - remaining_gaps))
        contract_gaps.append({"reason": reason, "durationSeconds": duration})
        remaining -= duration
    return {
        "evidenceStatus": "recorded",
        "monitoredSeconds": max(0, remaining),
        "expectedSeconds": expected,
        "gaps": contract_gaps,
    }


def _metric_command(
    definition: str,
    value: int,
    unit: str,
    source_window: dict[str, str],
    provenance: str,
    coverage: dict[str, Any],
) -> dict[str, Any]:
    quality = (
        "degraded"
        if coverage.get("evidenceStatus") == "recorded" and coverage.get("gapCount", 0) > 0
        else "estimated"
    )
    return {
        "definition": definition,
        "definitionVersion": 1,
        "value": value,
        "unit": unit,
        "grain": "site",
        "windowStart": source_window["start"],
        "windowEnd": source_window["end"],
        "timezone": "Asia/Manila",
        "provenance": provenance,
        "quality": quality,
        "coverage": coverage,
    }


def _demographic_facts(payload: dict[str, Any]) -> list[dict[str, Any]]:
    source_facts = payload.get("demographicFacts")
    if not isinstance(source_facts, list):
        return []

    supported_values = {
        "this_province_male",
        "this_province_female",
        "other_province_male",
        "other_province_female",
        "foreign_male",
        "foreign_female",
    }
    supported_qualities = {"confirmed", "degraded", "estimated"}
    facts: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for source_fact in source_facts:
        if not isinstance(source_fact, dict):
            continue
        dimension = source_fact.get("dimension")
        value = source_fact.get("value")
        count = source_fact.get("count")
        provenance = source_fact.get("provenance")
        quality = source_fact.get("quality")
        key = (str(dimension), str(value))
        if (
            dimension != "residence_sex"
            or not isinstance(value, str)
            or value not in supported_values
            or isinstance(count, bool)
            or not isinstance(count, int)
            or count < 0
            or count > MAX_DEMOGRAPHIC_COUNT
            or provenance != "operator_entered"
            or not isinstance(quality, str)
            or quality not in supported_qualities
            or key in seen
        ):
            continue
        seen.add(key)
        facts.append(
            {
                "dimension": dimension,
                "value": value,
                "count": count,
                "provenance": provenance,
                "quality": quality,
            }
        )
    return facts


def _utc_contract_timestamp(value: Any) -> str:
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value)
    else:
        parsed = value
    if not isinstance(parsed, datetime) or parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("Report command timestamps must include a UTC offset.")
    return parsed.astimezone(UTC).isoformat().replace("+00:00", "Z")
