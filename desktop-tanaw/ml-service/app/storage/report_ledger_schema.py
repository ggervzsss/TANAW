from __future__ import annotations

import hashlib
import json
import sqlite3
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from app.storage.reporting_periods import monthly_period_from_id, monthly_period_from_label

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


def migrate_report_ledger_v3(connection: sqlite3.Connection) -> None:
    _ensure_column(connection, "count_events", "camera_key", "text")
    _ensure_column(connection, "count_events", "camera_event_sequence", "integer")
    connection.execute(
        """
        create table if not exists local_camera_event_sequences (
            camera_key text primary key,
            next_sequence integer not null check (next_sequence >= 0)
        )
        """
    )
    _backfill_camera_event_sequences(connection)
    connection.execute(
        """
        create unique index if not exists idx_count_events_camera_sequence
        on count_events(camera_key, camera_event_sequence)
        where camera_key is not null and camera_event_sequence is not null
        """
    )
    for statement in _TARGET_REPORT_LEDGER_STATEMENTS:
        connection.execute(statement)
    _transform_legacy_reports(connection)


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


def _backfill_camera_event_sequences(connection: sqlite3.Connection) -> None:
    rows = connection.execute(
        """
        select id, camera_id, camera_name
        from count_events
        order by recorded_at, event_id
        """
    ).fetchall()
    next_by_camera: defaultdict[str, int] = defaultdict(int)
    for row in rows:
        camera_key = local_camera_key(row["camera_id"], row["camera_name"])
        sequence = next_by_camera[camera_key]
        next_by_camera[camera_key] += 1
        connection.execute(
            """
            update count_events
            set camera_key = ?, camera_event_sequence = ?
            where id = ?
            """,
            (camera_key, sequence, row["id"]),
        )
    connection.execute("delete from local_camera_event_sequences")
    connection.executemany(
        """
        insert into local_camera_event_sequences (camera_key, next_sequence)
        values (?, ?)
        """,
        sorted(next_by_camera.items()),
    )


def _transform_legacy_reports(connection: sqlite3.Connection) -> None:
    if not _table_exists(connection, "report_submissions"):
        return

    reports = connection.execute(
        """
        select
            report_id,
            period,
            reporting_period_id,
            submitted_at,
            entries,
            exits,
            peak_occupancy,
            unique_count,
            notes,
            payload_json,
            sync_status,
            source_kind,
            mock_run_id,
            synced_at,
            raw_purged_at
        from report_submissions
        order by submitted_at, report_id
        """
    ).fetchall()
    for report in reports:
        report_id = str(report["report_id"])
        if connection.execute(
            "select 1 from local_reports where report_id = ?", (report_id,)
        ).fetchone():
            continue

        event_rows = connection.execute(
            """
            select
                event_id,
                recorded_at,
                reporting_period_id,
                camera_id,
                camera_name,
                camera_key,
                camera_event_sequence,
                source_kind,
                mock_run_id
            from count_events
            where submitted_report_id = ?
            order by recorded_at, event_id
            """,
            (report_id,),
        ).fetchall()
        period_id = _legacy_period_id(report, event_rows)
        revision_id = _stable_id("revision", report_id)
        command_id = _stable_id("command", report_id)
        outbox_item_id = _stable_id("outbox", report_id)
        payload = _json_object(report["payload_json"])
        request_document = {
            "reportId": report_id,
            "reportingPeriodId": period_id,
            "period": str(report["period"]),
            "notes": report["notes"],
            "metrics": {
                "entries": int(report["entries"] or 0),
                "exits": int(report["exits"] or 0),
                "peakOccupancy": int(report["peak_occupancy"] or 0),
                "uniqueCount": int(report["unique_count"] or 0),
            },
            "payload": payload,
            "sourceKind": str(report["source_kind"] or "real"),
            "mockRunId": report["mock_run_id"],
        }
        request_hash = canonical_hash(request_document)
        request_idempotency_key = f"migration:{report_id}:{request_hash}"
        outbox_idempotency_key = central_report_idempotency_key(report_id, revision_id)
        batches = _legacy_source_batches(report_id, revision_id, period_id, event_rows)
        revision_document = _revision_document(
            revision_id=revision_id,
            report_id=report_id,
            revision_number=1,
            command_id=command_id,
            idempotency_key=outbox_idempotency_key,
            expected_version=0,
            period_id=period_id,
            period_label=str(report["period"]),
            submitted_at=str(report["submitted_at"]),
            entries=int(report["entries"] or 0),
            exits=int(report["exits"] or 0),
            peak_occupancy=int(report["peak_occupancy"] or 0),
            unique_count=int(report["unique_count"] or 0),
            notes=report["notes"],
            payload=payload,
            source_kind=str(report["source_kind"] or "real"),
            mock_run_id=report["mock_run_id"],
            source_batches=[batch["document"] for batch in batches],
        )
        revision_payload_json = canonical_json(revision_document)
        payload_hash = canonical_payload_hash(revision_document["payload"])

        connection.execute(
            """
            insert into local_reports (
                report_id,
                reporting_period_id,
                period_label,
                current_revision_id,
                created_at,
                updated_at,
                raw_purged_at
            )
            values (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                report_id,
                period_id,
                report["period"],
                revision_id,
                report["submitted_at"],
                report["submitted_at"],
                report["raw_purged_at"],
            ),
        )
        connection.execute(
            """
            insert into local_report_revisions (
                revision_id,
                report_id,
                revision_number,
                command_id,
                idempotency_key,
                request_hash,
                payload_hash,
                expected_version,
                submitted_at,
                entries,
                exits,
                peak_occupancy,
                unique_count,
                notes,
                payload_json,
                canonical_payload_json,
                source_kind,
                mock_run_id
            )
            values (?, ?, 1, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                revision_id,
                report_id,
                command_id,
                request_idempotency_key,
                request_hash,
                payload_hash,
                report["submitted_at"],
                int(report["entries"] or 0),
                int(report["exits"] or 0),
                int(report["peak_occupancy"] or 0),
                int(report["unique_count"] or 0),
                report["notes"],
                canonical_json(payload),
                revision_payload_json,
                str(report["source_kind"] or "real"),
                report["mock_run_id"],
            ),
        )
        for batch in batches:
            _insert_legacy_batch(
                connection,
                report_id,
                revision_id,
                batch,
                selected_at=str(report["submitted_at"]),
            )

        synced = str(report["sync_status"]).lower() == "synced"
        source_kind = str(report["source_kind"] or "real")
        invalid_source = not batches or any(
            not batch["sequence_valid"] or str(batch["camera_key"]).startswith("unassigned:")
            for batch in batches
        )
        unclassified = (period_id is None or invalid_source) and not synced
        simulation_source = source_kind != "real" and not synced
        status = (
            "acknowledged"
            if synced
            else "dead_letter"
            if unclassified or simulation_source
            else "ready"
        )
        if unclassified:
            last_error_class = "ambiguous_legacy_report_lineage"
            last_error_message = (
                "Legacy report has no deterministic period or contiguous camera lineage."
            )
        elif simulation_source:
            last_error_class = "simulation_not_official"
            last_error_message = "Simulation-derived reports cannot enter official intake."
        else:
            last_error_class = None
            last_error_message = None
        connection.execute(
            """
            insert into sync_outbox_items (
                outbox_item_id,
                report_revision_id,
                command_id,
                idempotency_key,
                endpoint,
                contract_version,
                payload_json,
                payload_hash,
                status,
                created_at,
                next_attempt_at,
                last_error_class,
                last_error_message,
                acknowledged_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                outbox_item_id,
                revision_id,
                command_id,
                outbox_idempotency_key,
                REPORT_OUTBOX_ENDPOINT,
                "report-submission.v2",
                revision_payload_json,
                payload_hash,
                status,
                report["submitted_at"],
                report["submitted_at"],
                last_error_class,
                last_error_message,
                report["synced_at"] if synced else None,
            ),
        )


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


def _legacy_period_id(report: sqlite3.Row, event_rows: list[sqlite3.Row]) -> str | None:
    if report["reporting_period_id"]:
        return str(report["reporting_period_id"])
    parsed = monthly_period_from_label(str(report["period"]))
    if parsed is not None:
        return parsed.period_id
    period_ids = {
        str(row["reporting_period_id"])
        for row in event_rows
        if row["reporting_period_id"] is not None
    }
    return period_ids.pop() if len(period_ids) == 1 else None


def _legacy_source_batches(
    report_id: str,
    revision_id: str,
    period_id: str | None,
    event_rows: list[sqlite3.Row],
) -> list[dict[str, Any]]:
    groups: defaultdict[tuple[Any, ...], list[sqlite3.Row]] = defaultdict(list)
    for row in event_rows:
        key = (
            row["reporting_period_id"],
            row["camera_key"],
            row["camera_id"],
            row["camera_name"],
            str(row["source_kind"] or "real"),
            row["mock_run_id"],
        )
        groups[key].append(row)

    batches: list[dict[str, Any]] = []
    for index, (key, rows) in enumerate(
        sorted(groups.items(), key=lambda item: tuple(str(value or "") for value in item[0])),
        start=1,
    ):
        event_period_id, camera_key, camera_id, camera_name, source_kind, mock_run_id = key
        rows.sort(key=lambda row: int(row["camera_event_sequence"] or 0))
        event_ids = [str(row["event_id"]) for row in rows]
        event_checksum = f"sha256:{canonical_hash(event_ids)}"
        sequences = [int(row["camera_event_sequence"]) for row in rows]
        sequence_start = min(sequences) if sequences else 0
        sequence_end = max(sequences) + 1 if sequences else 0
        sequence_valid = sequence_end - sequence_start == len(sequences)
        batch_id = _stable_id("batch", f"{report_id}:{index}:{event_checksum}")
        document = {
            "batchId": batch_id,
            "cameraId": str(camera_key),
            "eventCount": len(rows),
            "eventSequenceStart": sequence_start,
            "eventSequenceEndExclusive": sequence_end,
            "aggregateHash": event_checksum,
        }
        batches.append(
            {
                "batch_id": batch_id,
                "revision_id": revision_id,
                "period_id": event_period_id or period_id,
                "camera_id": camera_id,
                "camera_name": camera_name,
                "camera_key": camera_key,
                "source_kind": source_kind,
                "mock_run_id": mock_run_id,
                "sequence_start": sequence_start,
                "sequence_end": sequence_end,
                "sequence_valid": sequence_valid,
                "first_event_at": rows[0]["recorded_at"],
                "last_event_at": rows[-1]["recorded_at"],
                "event_checksum": event_checksum,
                "event_rows": rows,
                "document": document,
            }
        )
    return batches


def _insert_legacy_batch(
    connection: sqlite3.Connection,
    report_id: str,
    revision_id: str,
    batch: dict[str, Any],
    *,
    selected_at: str,
) -> None:
    rows: list[sqlite3.Row] = batch["event_rows"]
    document: dict[str, Any] = batch["document"]
    connection.execute(
        """
        insert into local_report_source_batches (
            batch_id,
            report_revision_id,
            reporting_period_id,
            camera_id,
            camera_name,
            central_camera_key,
            source_kind,
            mock_run_id,
            event_sequence_start,
            event_sequence_end_exclusive,
            first_event_at,
            last_event_at,
            event_count,
            event_checksum
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            batch["batch_id"],
            revision_id,
            batch["period_id"],
            batch["camera_id"],
            batch["camera_name"],
            batch["camera_key"],
            batch["source_kind"],
            batch["mock_run_id"],
            batch["sequence_start"],
            batch["sequence_end"],
            batch["first_event_at"],
            batch["last_event_at"],
            document["eventCount"],
            batch["event_checksum"],
        ),
    )
    connection.executemany(
        """
        insert into local_report_event_claims (event_id, report_id, claimed_at)
        values (?, ?, ?)
        on conflict(event_id) do nothing
        """,
        [(str(row["event_id"]), report_id, selected_at) for row in rows],
    )
    connection.executemany(
        """
        insert into local_report_event_memberships (
            report_revision_id,
            event_id,
            batch_id,
            selected_at
        )
        values (?, ?, ?, ?)
        """,
        [(revision_id, str(row["event_id"]), batch["batch_id"], selected_at) for row in rows],
    )


def _json_object(value: Any) -> dict[str, Any]:
    try:
        parsed = json.loads(str(value)) if value else {}
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _stable_id(kind: str, value: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"tanaw:local-ledger:{kind}:{value}"))


def _table_exists(connection: sqlite3.Connection, table_name: str) -> bool:
    return (
        connection.execute(
            "select 1 from sqlite_master where type = 'table' and name = ?",
            (table_name,),
        ).fetchone()
        is not None
    )


def _ensure_column(
    connection: sqlite3.Connection, table_name: str, column_name: str, definition: str
) -> None:
    columns = {
        str(row["name"])
        for row in connection.execute(f"pragma table_info({table_name})").fetchall()
    }
    if column_name not in columns:
        connection.execute(f"alter table {table_name} add column {column_name} {definition}")


_TARGET_REPORT_LEDGER_STATEMENTS = (
    """
    create table if not exists local_reports (
        report_id text primary key,
        reporting_period_id text,
        period_label text not null,
        current_revision_id text,
        created_at text not null,
        updated_at text not null,
        raw_purged_at text,
        last_acknowledged_logical_version integer not null default 0
            check (last_acknowledged_logical_version >= 0),
        foreign key (reporting_period_id) references reporting_periods(period_id),
        foreign key (current_revision_id) references local_report_revisions(revision_id)
            on delete set null deferrable initially deferred
    )
    """,
    """
    create unique index if not exists idx_local_reports_period
    on local_reports(reporting_period_id)
    where reporting_period_id is not null
    """,
    """
    create table if not exists local_report_revisions (
        revision_id text primary key,
        report_id text not null,
        revision_number integer not null check (revision_number > 0),
        command_id text not null,
        idempotency_key text not null,
        request_hash text not null,
        payload_hash text not null,
        expected_version integer not null check (expected_version >= 0),
        submitted_at text not null,
        entries integer not null check (entries >= 0),
        exits integer not null check (exits >= 0),
        peak_occupancy integer not null check (peak_occupancy >= 0),
        unique_count integer not null check (unique_count >= 0),
        notes text,
        payload_json text not null,
        canonical_payload_json text not null,
        source_kind text not null check (source_kind in ('real', 'mock', 'hybrid')),
        mock_run_id text,
        foreign key (report_id) references local_reports(report_id) on delete cascade,
        unique (report_id, revision_number),
        unique (report_id, idempotency_key),
        unique (command_id)
    )
    """,
    """
    create index if not exists idx_local_report_revisions_latest
    on local_report_revisions(report_id, revision_number desc)
    """,
    """
    create trigger if not exists trg_local_report_revisions_immutable
    before update on local_report_revisions
    begin
        select raise(abort, 'local report revisions are immutable');
    end
    """,
    """
    create table if not exists local_report_source_batches (
        batch_id text primary key,
        report_revision_id text not null,
        reporting_period_id text,
        camera_id integer,
        camera_name text,
        central_camera_key text not null,
        source_kind text not null check (source_kind in ('real', 'mock', 'hybrid')),
        mock_run_id text,
        event_sequence_start integer not null check (event_sequence_start >= 0),
        event_sequence_end_exclusive integer not null
            check (event_sequence_end_exclusive >= event_sequence_start),
        first_event_at text,
        last_event_at text,
        event_count integer not null check (event_count >= 0),
        event_checksum text not null,
        foreign key (report_revision_id)
            references local_report_revisions(revision_id) on delete cascade,
        foreign key (reporting_period_id) references reporting_periods(period_id)
    )
    """,
    """
    create index if not exists idx_local_report_source_batches_revision
    on local_report_source_batches(report_revision_id)
    """,
    """
    create table if not exists local_report_event_claims (
        event_id text primary key,
        report_id text not null,
        claimed_at text not null,
        foreign key (event_id) references count_events(event_id) on delete cascade,
        foreign key (report_id) references local_reports(report_id) on delete cascade
    )
    """,
    """
    create table if not exists local_report_event_memberships (
        report_revision_id text not null,
        event_id text not null,
        batch_id text not null,
        selected_at text not null,
        primary key (report_revision_id, event_id),
        foreign key (report_revision_id)
            references local_report_revisions(revision_id) on delete cascade,
        foreign key (event_id) references count_events(event_id) on delete cascade,
        foreign key (batch_id) references local_report_source_batches(batch_id) on delete cascade
    )
    """,
    """
    create index if not exists idx_local_report_event_memberships_batch
    on local_report_event_memberships(batch_id)
    """,
    """
    create table if not exists sync_outbox_items (
        outbox_item_id text primary key,
        report_revision_id text not null unique,
        command_id text not null unique,
        idempotency_key text not null unique,
        endpoint text not null,
        contract_version text not null,
        payload_json text not null,
        payload_hash text not null,
        status text not null check (
            status in ('ready', 'retry', 'in_flight', 'acknowledged', 'dead_letter')
        ),
        created_at text not null,
        next_attempt_at text not null,
        attempt_count integer not null default 0 check (attempt_count >= 0),
        last_attempt_at text,
        last_error_class text,
        last_error_message text,
        acknowledged_at text,
        acknowledgement_json text,
        foreign key (report_revision_id)
            references local_report_revisions(revision_id) on delete cascade
    )
    """,
    """
    create index if not exists idx_sync_outbox_ready
    on sync_outbox_items(status, next_attempt_at, created_at, outbox_item_id)
    """,
    """
    create table if not exists sync_attempts (
        attempt_id text primary key,
        outbox_item_id text not null,
        attempt_number integer not null check (attempt_number > 0),
        attempted_at text not null,
        completed_at text not null,
        outcome text not null check (outcome in ('acknowledged', 'retry', 'dead_letter')),
        error_class text,
        error_message text,
        http_status integer,
        next_attempt_at text,
        response_json text,
        foreign key (outbox_item_id) references sync_outbox_items(outbox_item_id)
            on delete cascade,
        unique (outbox_item_id, attempt_number)
    )
    """,
    """
    create index if not exists idx_sync_attempts_outbox
    on sync_attempts(outbox_item_id, attempt_number)
    """,
)
