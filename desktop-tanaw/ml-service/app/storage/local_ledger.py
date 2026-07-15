import json
import os
import random
import sqlite3
from collections import defaultdict
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Any
from uuid import UUID, uuid4

from app.storage.coverage import (
    coverage_summary as build_coverage_summary,
)
from app.storage.coverage import (
    end_monitoring_session as close_monitoring_session,
)
from app.storage.coverage import (
    mark_monitoring_connected as mark_session_connected,
)
from app.storage.coverage import (
    open_coverage_gap as insert_coverage_gap,
)
from app.storage.coverage import (
    start_monitoring_session as insert_monitoring_session,
)
from app.storage.ledger_writer import SerializedLedgerWriter, writer_for
from app.storage.local_schema import (
    upsert_reporting_period,
)
from app.storage.outbox import acknowledge as acknowledge_outbox
from app.storage.outbox import health as outbox_health
from app.storage.outbox import list_ready_items as list_ready_outbox_items
from app.storage.outbox import record_failure as record_outbox_failure
from app.storage.report_contract import (
    REPORT_OUTBOX_CONTRACT_VERSION,
    REPORT_OUTBOX_ENDPOINT,
    allocate_camera_event_sequences,
    build_revision_document,
    canonical_hash,
    canonical_json,
    canonical_payload_hash,
    central_report_idempotency_key,
    local_camera_key,
)
from app.storage.reporting_periods import (
    REPORTING_TIMEZONE,
    ReportingPeriod,
    monthly_period_for_captured_at,
    monthly_period_from_id,
    parse_captured_at,
)
from app.storage.retention import (
    purge_consolidated_report_raw_data,
    purge_expired_identity_data,
    retention_inventory,
)
from app.storage.rollups import record_metric_rollups
from app.storage.sqlite_retry import SQLiteRetryPolicy, run_sqlite_write
from app.storage.target_schema import (
    MAX_EVENT_ATTRIBUTES_BYTES,
    upsert_camera_live_state,
    upsert_local_camera,
)

_LOCAL_REPORT_SELECT = """
select
    report.report_id,
    report.period_label as period,
    report.reporting_period_id,
    period.starts_at_utc,
    period.ends_at_utc,
    report.last_acknowledged_logical_version,
    revision.revision_id,
    revision.revision_number,
    revision.payload_hash,
    revision.expected_version,
    revision.submitted_at,
    revision.entries,
    revision.exits,
    revision.peak_occupancy,
    revision.unique_count,
    revision.notes,
    revision.payload_json,
    case
        when outbox.status = 'acknowledged' then 'synced'
        else 'pending_cloud_sync'
    end as sync_status,
    revision.source_kind,
    revision.mock_run_id,
    outbox.outbox_item_id,
    outbox.acknowledged_at as synced_at,
    report.raw_purged_at
from local_reports as report
join reporting_periods as period
  on period.period_id = report.reporting_period_id
join local_report_revisions as revision
  on revision.revision_id = report.current_revision_id
join sync_outbox_items as outbox
  on outbox.report_revision_id = revision.revision_id
"""
_REPORT_REVISION_SELECT = _LOCAL_REPORT_SELECT.replace(
    "on revision.revision_id = report.current_revision_id",
    "on revision.report_id = report.report_id",
)


@dataclass
class _MetricsBucket:
    entries: int = 0
    exits: int = 0
    unique: int = 0
    peak_occupancy: int = 0
    current_occupancy: int = 0

    def add_event(self, row: sqlite3.Row) -> None:
        direction = row["direction"]
        occupancy = _safe_int(row["occupancy_count"])
        if direction == "entry":
            self.entries += 1
            if _safe_int(row["is_unique_entry"]) == 1:
                self.unique += 1
        elif direction == "exit":
            self.exits += 1

        self.peak_occupancy = max(self.peak_occupancy, occupancy)
        self.current_occupancy = occupancy

    def add_rollup(self, row: sqlite3.Row) -> None:
        self.entries += _safe_int(row["entries"])
        self.exits += _safe_int(row["exits"])
        self.unique += _safe_int(row["unique_entries"])
        self.peak_occupancy = max(self.peak_occupancy, _safe_int(row["peak_occupancy"]))
        self.current_occupancy = _safe_int(row["last_occupancy"])


class LocalLedger:
    def __init__(
        self,
        app_data_dir: str | None = None,
        enterprise_id: str | None = None,
        *,
        sqlite_retry_policy: SQLiteRetryPolicy | None = None,
        retry_sleep: Callable[[float], None] | None = None,
    ) -> None:
        base_dir = app_data_dir or os.environ.get("TANAW_APP_DATA_DIR")
        if base_dir:
            root = Path(base_dir) / "ml-service"
        else:
            root = Path.home() / ".tanaw" / "ml-service"

        self._root = root / "enterprises" / _safe_scope(enterprise_id) if enterprise_id else root
        self._enterprise_id = (
            enterprise_id.strip() if enterprise_id and enterprise_id.strip() else None
        )

        self._database_path = self._root / "tanaw_metrics.sqlite3"
        self._initialized = False
        self._initialize_lock = Lock()
        self._ledger_writer: SerializedLedgerWriter = writer_for(self._database_path)
        self._sqlite_retry_policy = sqlite_retry_policy or SQLiteRetryPolicy()
        self._retry_sleep = retry_sleep

    def append_count_event(self, payload: dict[str, Any], recorded_at: str | None = None) -> str:
        event_id = str(uuid4())
        recorded_at = recorded_at or _utc_now()
        captured_at = parse_captured_at(recorded_at)
        reporting_period = monthly_period_for_captured_at(captured_at)
        business_date = captured_at.astimezone(REPORTING_TIMEZONE).date().isoformat()
        raw_counts = payload.get("counts")
        counts: dict[str, Any] = raw_counts if isinstance(raw_counts, dict) else {}
        direction = payload.get("direction")
        is_unique_entry = payload.get("is_unique_entry")
        if is_unique_entry is None:
            is_unique_entry = direction == "entry"
        attributes_json = _encode_event_attributes(payload)

        camera_key = local_camera_key(
            payload.get("camera_id"),
            payload.get("camera_name"),
            payload.get("central_camera_id", payload.get("centralCameraId")),
        )

        def write_event(connection: sqlite3.Connection) -> None:
            upsert_reporting_period(connection, reporting_period)
            central_camera_id = (
                str(UUID(camera_key)) if not camera_key.startswith("unassigned:") else None
            )
            upsert_local_camera(
                connection,
                camera_key=camera_key,
                central_camera_id=central_camera_id,
                local_camera_id=payload.get("camera_id"),
                display_name=(
                    str(payload["camera_name"]) if payload.get("camera_name") is not None else None
                ),
                observed_at=captured_at.isoformat(),
            )
            camera_event_sequence = allocate_camera_event_sequences(connection, camera_key)
            connection.execute(
                """
                insert into count_events (
                    event_id,
                    recorded_at,
                    business_date,
                    reporting_period_id,
                    camera_key,
                    camera_event_sequence,
                    camera_id,
                    camera_name,
                    direction,
                    track_id,
                    entry_count,
                    exit_count,
                    occupancy_count,
                    visitor_id,
                    is_unique_entry,
                    reid_score,
                    reid_decision,
                    identity_confidence,
                    payload_schema_version,
                    attributes_json,
                    source_kind,
                    mock_run_id
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                """,
                (
                    event_id,
                    captured_at.isoformat(),
                    business_date,
                    reporting_period.period_id,
                    camera_key,
                    camera_event_sequence,
                    payload.get("camera_id"),
                    payload.get("camera_name"),
                    direction,
                    payload.get("track_id"),
                    _safe_int(counts.get("entry")),
                    _safe_int(counts.get("exit")),
                    _safe_int(counts.get("occupancy")),
                    payload.get("visitor_id"),
                    1 if is_unique_entry else 0,
                    _safe_float(payload.get("reid_score")),
                    payload.get("reid_decision"),
                    payload.get("identity_confidence"),
                    attributes_json,
                    payload.get("source_kind") or "real",
                    payload.get("mock_run_id"),
                ),
            )
            record_metric_rollups(
                connection,
                event={**payload, "is_unique_entry": is_unique_entry},
                captured_at=captured_at,
                reporting_period=reporting_period,
                business_date=business_date,
                camera_key=camera_key,
            )

        self._write("append_count_event", write_event)

        return event_id

    def start_monitoring_session(
        self,
        *,
        monitoring_session_id: str,
        camera_id: Any,
        camera_name: str | None,
        central_camera_id: Any = None,
        started_at: str | None = None,
    ) -> None:
        started_at = parse_captured_at(started_at or _utc_now()).isoformat()
        camera_key = local_camera_key(camera_id, camera_name, central_camera_id)
        normalized_central_id = (
            str(UUID(str(central_camera_id))) if central_camera_id is not None else None
        )

        def write_session(connection: sqlite3.Connection) -> None:
            upsert_local_camera(
                connection,
                camera_key=camera_key,
                central_camera_id=normalized_central_id,
                local_camera_id=camera_id,
                display_name=camera_name,
                observed_at=started_at,
            )
            insert_monitoring_session(
                connection,
                monitoring_session_id=monitoring_session_id,
                camera_key=camera_key,
                central_camera_id=normalized_central_id,
                camera_name=camera_name,
                started_at=started_at,
            )

        self._write("start_monitoring_session", write_session)

    def mark_monitoring_connected(
        self, monitoring_session_id: str, connected_at: str | None = None
    ) -> None:
        connected_at = parse_captured_at(connected_at or _utc_now()).isoformat()
        self._write(
            "mark_monitoring_connected",
            lambda connection: mark_session_connected(
                connection, monitoring_session_id, connected_at
            ),
        )

    def record_coverage_gap(
        self,
        *,
        monitoring_session_id: str,
        camera_id: Any,
        camera_name: str | None,
        central_camera_id: Any = None,
        started_at: str | None = None,
        reason: str,
        recoverable: bool,
        detail: str | None = None,
    ) -> str:
        captured_at = parse_captured_at(started_at or _utc_now())
        period = monthly_period_for_captured_at(captured_at)
        camera_key = local_camera_key(camera_id, camera_name, central_camera_id)
        result: list[str] = []

        def write_gap(connection: sqlite3.Connection) -> None:
            upsert_reporting_period(connection, period)
            result.append(
                insert_coverage_gap(
                    connection,
                    monitoring_session_id=monitoring_session_id,
                    camera_key=camera_key,
                    started_at=captured_at.isoformat(),
                    reason=reason,
                    recoverable=recoverable,
                    detail=detail,
                )
            )

        self._write("record_coverage_gap", write_gap)
        return result[0]

    def end_monitoring_session(
        self,
        monitoring_session_id: str,
        *,
        ended_at: str | None = None,
        reason: str = "operator_stopped",
        error: bool = False,
    ) -> None:
        ended_at = parse_captured_at(ended_at or _utc_now()).isoformat()
        self._write(
            "end_monitoring_session",
            lambda connection: close_monitoring_session(
                connection,
                monitoring_session_id,
                ended_at=ended_at,
                reason=reason,
                error=error,
            ),
        )

    def monitoring_coverage(self, period_id: str, *, as_of: str | None = None) -> dict[str, Any]:
        period = monthly_period_from_id(period_id)
        if period is None:
            raise ValueError(f"Invalid canonical reporting period: {period_id}")
        with self._connection() as connection:
            return build_coverage_summary(
                connection,
                period=period,
                as_of=as_of or _utc_now(),
            )

    def record_persistence_error(
        self,
        *,
        operation: str,
        reason: str,
        detail: str,
        attempt_count: int,
        occurred_at: str | None = None,
    ) -> str:
        error_id = str(uuid4())
        occurred_at = parse_captured_at(occurred_at or _utc_now()).isoformat()

        def write_error(connection: sqlite3.Connection) -> None:
            connection.execute(
                """
                insert into local_persistence_errors (
                    persistence_error_id,
                    operation,
                    reason,
                    detail,
                    attempt_count,
                    occurred_at
                )
                values (?, ?, ?, ?, ?, ?)
                """,
                (error_id, operation, reason, detail, attempt_count, occurred_at),
            )

        self._write("record_persistence_error", write_error)
        return error_id

    def list_persistence_errors(self) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute(
                """
                select *
                from local_persistence_errors
                order by occurred_at, persistence_error_id
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def upsert_visitor_identity(
        self,
        *,
        visitor_id: str,
        business_date: str,
        camera_id: int | None,
        embedding: bytes,
        embedding_dim: int,
        embedding_count: int,
        model_name: str,
        expires_at: str,
        recorded_at: str | None = None,
    ) -> None:
        recorded_at = recorded_at or _utc_now()
        with self._connection() as connection:
            connection.execute(
                """
                insert into visitor_identities (
                    visitor_id,
                    business_date,
                    camera_id,
                    first_seen_at,
                    last_seen_at,
                    representative_embedding,
                    embedding_dim,
                    embedding_count,
                    model_name,
                    expires_at
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                on conflict(visitor_id) do update set
                    last_seen_at = excluded.last_seen_at,
                    representative_embedding = excluded.representative_embedding,
                    embedding_dim = excluded.embedding_dim,
                    embedding_count = excluded.embedding_count,
                    model_name = excluded.model_name,
                    expires_at = excluded.expires_at
                """,
                (
                    visitor_id,
                    business_date,
                    camera_id,
                    recorded_at,
                    recorded_at,
                    embedding,
                    embedding_dim,
                    embedding_count,
                    model_name,
                    expires_at,
                ),
            )

    def append_visitor_sighting(
        self, payload: dict[str, Any], recorded_at: str | None = None
    ) -> str:
        sighting_id = str(uuid4())
        recorded_at = recorded_at or _utc_now()
        with self._connection() as connection:
            connection.execute(
                """
                insert into visitor_sightings (
                    sighting_id,
                    visitor_id,
                    recorded_at,
                    business_date,
                    camera_id,
                    track_id,
                    direction,
                    reid_score,
                    reid_decision,
                    identity_confidence,
                    detection_confidence,
                    bbox_json,
                    payload_json
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    sighting_id,
                    payload["visitor_id"],
                    recorded_at,
                    payload["business_date"],
                    payload.get("camera_id"),
                    payload.get("track_id"),
                    payload.get("direction"),
                    _safe_float(payload.get("reid_score")),
                    payload["reid_decision"],
                    payload["identity_confidence"],
                    _safe_float(payload.get("detection_confidence")),
                    json.dumps(payload.get("bbox"), sort_keys=True)
                    if payload.get("bbox") is not None
                    else None,
                    json.dumps(payload, sort_keys=True),
                ),
            )

        return sighting_id

    def upsert_visitor_model_embedding(
        self,
        *,
        visitor_id: str,
        model_name: str,
        embedding: bytes,
        embedding_dim: int,
        embedding_count: int,
        recorded_at: str | None = None,
    ) -> None:
        recorded_at = recorded_at or _utc_now()
        with self._connection() as connection:
            connection.execute(
                """
                insert into visitor_model_embeddings (
                    visitor_id,
                    model_name,
                    representative_embedding,
                    embedding_dim,
                    embedding_count,
                    updated_at
                )
                values (?, ?, ?, ?, ?, ?)
                on conflict(visitor_id, model_name) do update set
                    representative_embedding = excluded.representative_embedding,
                    embedding_dim = excluded.embedding_dim,
                    embedding_count = excluded.embedding_count,
                    updated_at = excluded.updated_at
                """,
                (
                    visitor_id,
                    model_name,
                    embedding,
                    embedding_dim,
                    embedding_count,
                    recorded_at,
                ),
            )

    def load_active_visitor_identities(
        self, business_date: str, now: str | None = None
    ) -> list[dict[str, Any]]:
        now = now or _utc_now()
        with self._connection() as connection:
            rows = connection.execute(
                """
                select
                    visitor_id,
                    business_date,
                    camera_id,
                    first_seen_at,
                    last_seen_at,
                    representative_embedding,
                    embedding_dim,
                    embedding_count,
                    model_name,
                    expires_at
                from visitor_identities
                where business_date = ?
                    and expires_at > ?
                order by last_seen_at desc
                """,
                (business_date, now),
            ).fetchall()

        return [dict(row) for row in rows]

    def load_active_visitor_model_embeddings(
        self,
        business_date: str,
        model_name: str,
        now: str | None = None,
    ) -> list[dict[str, Any]]:
        now = now or _utc_now()
        with self._connection() as connection:
            rows = connection.execute(
                """
                select
                    embeddings.visitor_id,
                    identities.business_date,
                    identities.camera_id,
                    embeddings.representative_embedding,
                    embeddings.embedding_dim,
                    embeddings.embedding_count,
                    embeddings.model_name,
                    identities.expires_at
                from visitor_model_embeddings as embeddings
                join visitor_identities as identities
                    on identities.visitor_id = embeddings.visitor_id
                where identities.business_date = ?
                    and identities.expires_at > ?
                    and embeddings.model_name = ?
                order by embeddings.updated_at desc
                """,
                (business_date, now, model_name),
            ).fetchall()

        return [dict(row) for row in rows]

    def cleanup_expired_visitor_metadata(self, now: str | None = None) -> int:
        now = now or _utc_now()
        with self._connection(immediate=True) as connection:
            result = purge_expired_identity_data(connection, expires_at_or_before=now)
        return result["identities"]

    def save_runtime_snapshot(
        self, payload: dict[str, Any], recorded_at: str | None = None
    ) -> None:
        raw_counts = payload.get("counts")
        counts: dict[str, Any] = raw_counts if isinstance(raw_counts, dict) else {}
        raw_config = payload.get("camera_config")
        camera_config: dict[str, Any] = raw_config if isinstance(raw_config, dict) else {}
        observed_at = parse_captured_at(recorded_at or _utc_now()).isoformat()
        snapshot_json = _encode_runtime_snapshot(payload)
        camera_key = local_camera_key(
            payload.get("camera_id"),
            payload.get("camera_name"),
            payload.get(
                "central_camera_id",
                payload.get(
                    "centralCameraId",
                    camera_config.get("central_camera_id", camera_config.get("centralCameraId")),
                ),
            ),
        )
        central_camera_id = (
            str(UUID(camera_key)) if not camera_key.startswith("unassigned:") else None
        )

        def write_state(connection: sqlite3.Connection) -> None:
            upsert_local_camera(
                connection,
                camera_key=camera_key,
                central_camera_id=central_camera_id,
                local_camera_id=payload.get("camera_id"),
                display_name=(
                    str(payload["camera_name"]) if payload.get("camera_name") is not None else None
                ),
                observed_at=observed_at,
            )
            upsert_camera_live_state(
                connection,
                camera_key=camera_key,
                observed_at=observed_at,
                status=payload.get("status"),
                running=bool(payload.get("running")),
                entry_count=_safe_int(counts.get("entry")),
                exit_count=_safe_int(counts.get("exit")),
                occupancy_count=_safe_int(counts.get("occupancy")),
                error=payload.get("error"),
            )
            connection.execute(
                """
                insert into camera_runtime_state (camera_key, snapshot_json, updated_at)
                values (?, ?, ?)
                on conflict(camera_key) do update set
                    snapshot_json = excluded.snapshot_json,
                    updated_at = excluded.updated_at
                where excluded.updated_at >= camera_runtime_state.updated_at
                """,
                (camera_key, snapshot_json, observed_at),
            )

        self._write("save_runtime_snapshot", write_state)

    def load_runtime_snapshot(self) -> dict[str, Any] | None:
        with self._connection() as connection:
            row = connection.execute(
                """
                select snapshot_json
                from camera_runtime_state
                order by updated_at desc, camera_key
                limit 1
                """
            ).fetchone()
        if row is None:
            return None
        try:
            payload = json.loads(str(row["snapshot_json"]))
        except json.JSONDecodeError:
            return None
        return payload if isinstance(payload, dict) else None

    def record_occupancy_correction(
        self,
        *,
        enterprise_id: str | None,
        camera_id: int | None,
        old_occupancy: int,
        new_occupancy: int,
        reason: str,
        actor_id: str | None = None,
        actor_name: str | None = None,
        source_kind: str = "real",
        mock_run_id: str | None = None,
        recorded_at: str | None = None,
    ) -> dict[str, Any]:
        correction_id = str(uuid4())
        recorded_at = recorded_at or _utc_now()
        delta = max(0, new_occupancy) - max(0, old_occupancy)
        payload = {
            "correction_id": correction_id,
            "enterprise_id": enterprise_id,
            "camera_id": camera_id,
            "old_occupancy": max(0, old_occupancy),
            "new_occupancy": max(0, new_occupancy),
            "delta": delta,
            "reason": reason,
            "actor_id": actor_id,
            "actor_name": actor_name,
            "source_kind": source_kind,
            "mock_run_id": mock_run_id,
            "recorded_at": recorded_at,
        }

        with self._connection() as connection:
            connection.execute(
                """
                insert into occupancy_corrections (
                    correction_id,
                    enterprise_id,
                    camera_id,
                    old_occupancy,
                    new_occupancy,
                    delta,
                    reason,
                    actor_id,
                    actor_name,
                    source_kind,
                    mock_run_id,
                    recorded_at,
                    payload_json
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    correction_id,
                    enterprise_id,
                    camera_id,
                    payload["old_occupancy"],
                    payload["new_occupancy"],
                    delta,
                    reason,
                    actor_id,
                    actor_name,
                    source_kind,
                    mock_run_id,
                    recorded_at,
                    json.dumps(payload, sort_keys=True),
                ),
            )

        return payload

    def list_occupancy_corrections(self, limit: int = 100) -> list[dict[str, Any]]:
        limit = max(1, min(limit, 500))
        with self._connection() as connection:
            rows = connection.execute(
                """
                select
                    correction_id,
                    enterprise_id,
                    camera_id,
                    old_occupancy,
                    new_occupancy,
                    delta,
                    reason,
                    actor_id,
                    actor_name,
                    source_kind,
                    mock_run_id,
                    recorded_at
                from occupancy_corrections
                order by recorded_at desc
                limit ?
                """,
                (limit,),
            ).fetchall()

        return [dict(row) for row in rows]

    def metrics_summary(
        self,
        include_submitted: bool = False,
        period_id: str | None = None,
    ) -> dict[str, Any]:
        with self._connection() as connection:
            return self._metrics_summary(
                connection,
                include_submitted=include_submitted,
                period_id=period_id,
            )

    def _metrics_summary(
        self,
        connection: sqlite3.Connection,
        *,
        include_submitted: bool,
        period_id: str | None,
    ) -> dict[str, Any]:
        selected_period = _resolve_summary_period(
            connection,
            include_submitted=include_submitted,
            requested_period_id=period_id,
        )
        scope_conditions: list[str] = []
        params: list[str] = []
        if selected_period is None:
            scope_conditions.append("0 = 1")
        else:
            scope_conditions.extend(
                [
                    "reporting_period_id = ?",
                    "recorded_at >= ?",
                    "recorded_at < ?",
                ]
            )
            params.extend(
                [
                    selected_period.period_id,
                    selected_period.starts_at_utc.isoformat(),
                    selected_period.ends_at_utc.isoformat(),
                ]
            )
        scope_filter = " and ".join(scope_conditions) or "1 = 1"
        event_filter = scope_filter
        if not include_submitted:
            event_filter = f"{_open_event_filter()} and {scope_filter}"
        if include_submitted:
            rollup_conditions = ["grain = 'hour'"]
            rollup_params: list[str] = []
            if selected_period is None:
                rollup_conditions.append("0 = 1")
            else:
                rollup_conditions.append("reporting_period_id = ?")
                rollup_params.append(selected_period.period_id)
            rollup_filter = " and ".join(rollup_conditions)
            row = connection.execute(
                f"""
                select
                    sum(event_count) as total_events,
                    sum(entries) as entries,
                    sum(exits) as exits,
                    sum(unique_entries) as unique_entries,
                    sum(confirmed_unique_entries) as confirmed_unique_entries,
                    sum(degraded_unique_entries) as degraded_unique_entries,
                    max(peak_occupancy) as peak_occupancy,
                    min(first_event_at) as first_event_at,
                    max(last_event_at) as last_event_at
                from metric_rollups
                where {rollup_filter}
                """,
                rollup_params,
            ).fetchone()
        else:
            row = connection.execute(
                f"""
                select
                    count(*) as total_events,
                    sum(case when direction = 'entry' then 1 else 0 end) as entries,
                    sum(case when direction = 'exit' then 1 else 0 end) as exits,
                    sum(case when direction = 'entry' and is_unique_entry = 1 then 1 else 0 end)
                        as unique_entries,
                    sum(
                        case
                            when direction = 'entry'
                             and is_unique_entry = 1
                             and visitor_id is not null
                             and visitor_id != ''
                            then 1 else 0
                        end
                    ) as confirmed_unique_entries,
                    sum(
                        case
                            when direction = 'entry'
                             and is_unique_entry = 1
                             and (visitor_id is null or visitor_id = '')
                            then 1 else 0
                        end
                    ) as degraded_unique_entries,
                    max(occupancy_count) as peak_occupancy,
                    min(recorded_at) as first_event_at,
                    max(recorded_at) as last_event_at
                from count_events
                where {event_filter}
                """,
                params,
            ).fetchone()
        unsubmitted_count = connection.execute(
            f"""
            select count(*)
            from count_events
            where {_open_event_filter()}
              and {scope_filter}
            """,
            params,
        ).fetchone()[0]
        unsynced_count = connection.execute(
            f"""
            select count(distinct membership.event_id)
            from local_report_event_memberships as membership
            join count_events
              on count_events.event_id = membership.event_id
            join sync_outbox_items as outbox
              on outbox.report_revision_id = membership.report_revision_id
            where outbox.status != 'acknowledged'
              and {scope_filter}
            """,
            params,
        ).fetchone()[0]
        unclassified_count = connection.execute(
            "select count(*) from count_events where reporting_period_id is null"
        ).fetchone()[0]
        if include_submitted:
            source_rows = connection.execute(
                f"""
                select distinct source_kind, nullif(mock_run_key, '') as mock_run_id
                from metric_rollups
                where {rollup_filter}
                """,
                rollup_params,
            ).fetchall()
        else:
            source_rows = connection.execute(
                f"""
                select distinct source_kind, mock_run_id
                from count_events
                where {event_filter}
                """,
                params,
            ).fetchall()
        if selected_period is None:
            correction_delta = 0
        else:
            correction_delta = connection.execute(
                """
                select coalesce(sum(delta), 0)
                from occupancy_corrections
                where recorded_at >= ? and recorded_at < ?
                """,
                (
                    selected_period.starts_at_utc.isoformat(),
                    selected_period.ends_at_utc.isoformat(),
                ),
            ).fetchone()[0]

        entries = _safe_int(row["entries"])
        exits = _safe_int(row["exits"])
        normalized_correction_delta = _safe_int(correction_delta)
        current_occupancy = max(0, entries - exits + normalized_correction_delta)
        estimated_unique_count = _safe_int(row["unique_entries"])
        source_kind, mock_run_id = _provenance_for_rows(source_rows)
        return {
            "entries": entries,
            "exits": exits,
            "peak_occupancy": max(_safe_int(row["peak_occupancy"]), current_occupancy),
            "current_occupancy": current_occupancy,
            "unique_count": estimated_unique_count,
            "estimated_unique_count": estimated_unique_count,
            "confirmed_unique_count": _safe_int(row["confirmed_unique_entries"]),
            "degraded_unique_count": _safe_int(row["degraded_unique_entries"]),
            "pending_unique_entries": 0,
            "repeat_entry_count": max(0, entries - estimated_unique_count),
            "occupancy_correction_delta": normalized_correction_delta,
            "total_events": _safe_int(row["total_events"]),
            "unsubmitted_events": _safe_int(unsubmitted_count),
            "unsynced_events": _safe_int(unsynced_count),
            "unclassified_events": _safe_int(unclassified_count),
            "first_event_at": row["first_event_at"],
            "last_event_at": row["last_event_at"],
            "source_kind": source_kind,
            "mock_run_id": mock_run_id,
            "period_id": selected_period.period_id if selected_period else None,
            "period": selected_period.label if selected_period else None,
            "starts_at_utc": (
                selected_period.starts_at_utc.isoformat() if selected_period else None
            ),
            "ends_at_utc": (selected_period.ends_at_utc.isoformat() if selected_period else None),
            "business_start_date": (
                selected_period.business_start_date.isoformat() if selected_period else None
            ),
            "business_end_date_exclusive": (
                selected_period.business_end_date_exclusive.isoformat() if selected_period else None
            ),
        }

    def metrics_history(
        self,
        include_submitted: bool = False,
        now: datetime | None = None,
        period_id: str | None = None,
    ) -> dict[str, Any]:
        now = _normalize_datetime(now or datetime.now().astimezone())
        local_timezone = now.tzinfo or UTC
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today_start - timedelta(days=6)
        month_start = today_start - timedelta(days=29)

        with self._connection() as connection:
            selected_period = _resolve_summary_period(
                connection,
                include_submitted=include_submitted,
                requested_period_id=period_id,
            )
            conditions = [] if include_submitted else [_open_event_filter()]
            params: list[str] = []
            if selected_period is None:
                conditions.append("0 = 1")
            else:
                conditions.extend(
                    [
                        "reporting_period_id = ?",
                        "recorded_at >= ?",
                        "recorded_at < ?",
                    ]
                )
                params.extend(
                    [
                        selected_period.period_id,
                        selected_period.starts_at_utc.isoformat(),
                        selected_period.ends_at_utc.isoformat(),
                    ]
                )
            if include_submitted:
                rollup_conditions = ["grain = 'hour'"]
                rollup_params: list[str] = []
                if selected_period is None:
                    rollup_conditions.append("0 = 1")
                else:
                    rollup_conditions.append("reporting_period_id = ?")
                    rollup_params.append(selected_period.period_id)
                rows = connection.execute(
                    f"""
                    select
                        bucket_start_at as recorded_at,
                        entries,
                        exits,
                        unique_entries,
                        peak_occupancy,
                        last_occupancy
                    from metric_rollups
                    where {" and ".join(rollup_conditions)}
                    order by bucket_start_at asc
                    """,
                    rollup_params,
                ).fetchall()
            else:
                rows = connection.execute(
                    f"""
                    select recorded_at, direction, occupancy_count, is_unique_entry
                    from count_events
                    where {" and ".join(conditions) or "1 = 1"}
                    order by recorded_at asc
                    """,
                    params,
                ).fetchall()

        hourly_buckets = [_MetricsBucket() for _ in range(24)]
        today_buckets = [_MetricsBucket() for _ in range(24)]
        week_buckets = [_MetricsBucket() for _ in range(7)]
        month_buckets = [_MetricsBucket() for _ in range(30)]

        for row in rows:
            recorded_at = _parse_recorded_at(row["recorded_at"]).astimezone(local_timezone)
            if recorded_at < month_start or recorded_at > now:
                continue

            add_row = _MetricsBucket.add_rollup if include_submitted else _MetricsBucket.add_event
            add_row(month_buckets[(recorded_at.date() - month_start.date()).days], row)

            if recorded_at >= week_start:
                add_row(week_buckets[(recorded_at.date() - week_start.date()).days], row)

            if recorded_at.date() == today_start.date():
                add_row(hourly_buckets[recorded_at.hour], row)
                add_row(today_buckets[recorded_at.hour], row)

        return {
            "hourly_density": [
                {
                    "time": _format_hour_label(today_start + timedelta(hours=hour)),
                    "occupancy": bucket.peak_occupancy,
                    "entry": bucket.entries,
                    "exit": bucket.exits,
                    "unique": bucket.unique,
                }
                for hour, bucket in enumerate(hourly_buckets)
            ],
            "historical": {
                "Today": [
                    _trend_point(_format_hour_label(today_start + timedelta(hours=hour)), bucket)
                    for hour, bucket in enumerate(today_buckets)
                ],
                "Week": [
                    _trend_point(_format_day_label(week_start + timedelta(days=day)), bucket)
                    for day, bucket in enumerate(week_buckets)
                ],
                "Month": [
                    _trend_point(_format_month_day_label(month_start + timedelta(days=day)), bucket)
                    for day, bucket in enumerate(month_buckets)
                ],
            },
        }

    def create_local_report_revision(
        self,
        report_id: str,
        period_id: str,
        notes: str | None = None,
        payload: dict[str, Any] | None = None,
        metrics: dict[str, Any] | None = None,
        source_kind: str | None = None,
        mock_run_id: str | None = None,
        *,
        idempotency_key: str | None = None,
        command_id: str | None = None,
    ) -> dict[str, Any]:
        submitted_at = _utc_now()
        report_payload = payload or {}
        payload_status = (
            report_payload.get("status") if isinstance(report_payload.get("status"), str) else None
        )
        requested_metrics = _normalized_requested_metrics(metrics)
        request_document = {
            "reportId": report_id,
            "periodKey": period_id,
            "notes": notes,
            "metrics": requested_metrics,
            "payload": report_payload,
            "sourceKind": source_kind,
            "mockRunId": mock_run_id,
        }
        request_hash = canonical_hash(request_document)
        resolved_idempotency_key = idempotency_key or f"local:{report_id}:{request_hash}"
        if command_id is not None:
            try:
                normalized_command_id = str(UUID(command_id))
            except ValueError as exc:
                raise ValueError("Command ID must be a valid UUID.") from exc
        else:
            normalized_command_id = None
        with self._connection(immediate=True) as connection:
            existing_report = self._local_report_from_connection(connection, report_id)
            reporting_period = monthly_period_from_id(period_id)
            if reporting_period is None:
                raise ValueError("Reporting period ID must use month:Asia/Manila:YYYY-MM.")
            upsert_reporting_period(connection, reporting_period)
            idempotent_revision = connection.execute(
                """
                select revision_id, report_id, request_hash
                from local_report_revisions
                where idempotency_key = ?
                """,
                (resolved_idempotency_key,),
            ).fetchone()
            if idempotent_revision is not None:
                if (
                    str(idempotent_revision["report_id"]) != report_id
                    or str(idempotent_revision["request_hash"]) != request_hash
                ):
                    raise ValueError(
                        "Idempotency key was already used with a different report payload."
                    )
                record = _report_revision_record(
                    connection, str(idempotent_revision["revision_id"])
                )
                return _revision_response_from_record(connection, record)
            if (
                normalized_command_id is not None
                and connection.execute(
                    "select 1 from local_report_revisions where command_id = ?",
                    (normalized_command_id,),
                ).fetchone()
            ):
                raise ValueError("Command ID was already used by another report revision.")

            existing_period_report = self._local_report_for_period_from_connection(
                connection,
                reporting_period.period_id,
            )
            if (
                existing_period_report is not None
                and existing_period_report["report_id"] != report_id
            ):
                raise ValueError(
                    f"A report for {reporting_period.label} has already been submitted."
                )
            if (
                existing_report is not None
                and existing_report["period_id"] != reporting_period.period_id
            ):
                raise ValueError("A logical report cannot be moved to another reporting period.")

            summary = self._metrics_summary(
                connection,
                include_submitted=False,
                period_id=reporting_period.period_id,
            )
            if existing_report is not None and metrics is None:
                summary = {
                    **summary,
                    "entries": existing_report["entries"],
                    "exits": existing_report["exits"],
                    "peak_occupancy": existing_report["peak_occupancy"],
                    "current_occupancy": max(
                        0, existing_report["entries"] - existing_report["exits"]
                    ),
                    "unique_count": existing_report["unique_count"],
                }
            if metrics is not None:
                summary = _summary_with_report_metrics(summary, metrics)

            should_consume_open_events = existing_report is None and payload_status != "Resubmitted"
            if should_consume_open_events:
                unclassified_official_events = connection.execute(
                    f"""
                    select count(*)
                    from count_events
                    where {_open_event_filter()}
                      and reporting_period_id is null
                      and source_kind in ('real', 'hybrid')
                    """
                ).fetchone()[0]
                if unclassified_official_events:
                    raise ValueError(
                        "Official report submission is blocked because one or more open "
                        "events have no reporting period. Repair or quarantine those events "
                        "instead of assigning them to the current month."
                    )

            resolved_source_kind = source_kind or (
                str(existing_report["source_kind"])
                if existing_report is not None and existing_report["source_kind"]
                else str(summary["source_kind"])
            )
            resolved_mock_run_id = mock_run_id or (
                str(existing_report["mock_run_id"])
                if existing_report is not None and existing_report["mock_run_id"]
                else str(summary["mock_run_id"])
                if summary["mock_run_id"]
                else None
            )
            if resolved_source_kind not in {"real", "mock", "hybrid"}:
                raise ValueError("Report source kind must be real, mock, or hybrid.")

            selected_events: list[sqlite3.Row] = []
            if should_consume_open_events:
                selected_events = connection.execute(
                    f"""
                    select
                        event_id,
                        recorded_at,
                        camera_id,
                        camera_name,
                        camera_key,
                        camera_event_sequence,
                        source_kind,
                        mock_run_id
                    from count_events
                    where {_open_event_filter()}
                      and reporting_period_id = ?
                      and recorded_at >= ?
                      and recorded_at < ?
                    order by recorded_at, event_id
                    """,
                    (
                        reporting_period.period_id,
                        reporting_period.starts_at_utc.isoformat(),
                        reporting_period.ends_at_utc.isoformat(),
                    ),
                ).fetchall()
            elif existing_report is not None:
                selected_events = connection.execute(
                    """
                    select
                        event.event_id,
                        event.recorded_at,
                        event.camera_id,
                        event.camera_name,
                        event.source_kind,
                        event.mock_run_id,
                        event.camera_key,
                        event.camera_event_sequence
                    from count_events as event
                    join local_report_event_memberships as membership
                      on membership.event_id = event.event_id
                    where membership.report_revision_id = ?
                    order by event.recorded_at, event.event_id
                    """,
                    (existing_report["revision_id"],),
                ).fetchall()
                if not selected_events:
                    raise ValueError(
                        "A new revision cannot be created after its raw source events were purged."
                    )

            revision_number = 1
            if existing_report is not None:
                revision_number = int(existing_report["revision_number"]) + 1
            revision_id = str(uuid4())
            resolved_command_id = normalized_command_id or str(uuid4())
            outbox_item_id = str(uuid4())
            expected_version = (
                _safe_int(existing_report["last_acknowledged_logical_version"])
                if existing_report is not None
                else 0
            )
            outbox_idempotency_key = central_report_idempotency_key(report_id, revision_id)
            source_batches = _source_batches_for_events(
                revision_id=revision_id,
                period_id=reporting_period.period_id,
                event_rows=selected_events,
            )
            coverage = build_coverage_summary(
                connection,
                period=reporting_period,
                as_of=submitted_at,
            )
            revision_document = build_revision_document(
                revision_id=revision_id,
                report_id=report_id,
                revision_number=revision_number,
                command_id=resolved_command_id,
                idempotency_key=outbox_idempotency_key,
                expected_version=expected_version,
                period_id=reporting_period.period_id,
                period_label=reporting_period.label,
                submitted_at=submitted_at,
                entries=_safe_int(summary["entries"]),
                exits=_safe_int(summary["exits"]),
                peak_occupancy=_safe_int(summary["peak_occupancy"]),
                unique_count=_safe_int(summary["unique_count"]),
                notes=notes,
                payload=report_payload,
                source_kind=resolved_source_kind,
                mock_run_id=resolved_mock_run_id,
                source_batches=[batch["document"] for batch in source_batches],
                coverage_evidence=coverage,
            )
            canonical_payload = canonical_json(revision_document)
            payload_hash = canonical_payload_hash(revision_document["payload"])

            if existing_report is None:
                connection.execute(
                    """
                    insert into local_reports (
                        report_id,
                        reporting_period_id,
                        period_label,
                        current_revision_id,
                        created_at,
                        updated_at
                    )
                    values (?, ?, ?, null, ?, ?)
                    """,
                    (
                        report_id,
                        reporting_period.period_id,
                        reporting_period.label,
                        submitted_at,
                        submitted_at,
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
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    revision_id,
                    report_id,
                    revision_number,
                    resolved_command_id,
                    resolved_idempotency_key,
                    request_hash,
                    payload_hash,
                    expected_version,
                    submitted_at,
                    summary["entries"],
                    summary["exits"],
                    summary["peak_occupancy"],
                    summary["unique_count"],
                    notes,
                    canonical_json(report_payload),
                    canonical_payload,
                    resolved_source_kind,
                    resolved_mock_run_id,
                ),
            )
            _insert_source_batches_and_memberships(
                connection,
                report_id=report_id,
                revision_id=revision_id,
                source_batches=source_batches,
                selected_at=submitted_at,
            )
            if not source_batches:
                outbox_status = "dead_letter"
                outbox_error_class = "missing_source_lineage"
                outbox_error_message = "Report revision has no exact camera source batch."
            elif resolved_source_kind != "real":
                outbox_status = "dead_letter"
                outbox_error_class = "simulation_not_official"
                outbox_error_message = "Simulation-derived reports cannot enter official intake."
            else:
                outbox_status = "ready"
                outbox_error_class = None
                outbox_error_message = None
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
                    next_attempt_at
                    ,last_error_class
                    ,last_error_message
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    outbox_item_id,
                    revision_id,
                    resolved_command_id,
                    outbox_idempotency_key,
                    REPORT_OUTBOX_ENDPOINT,
                    REPORT_OUTBOX_CONTRACT_VERSION,
                    canonical_payload,
                    payload_hash,
                    outbox_status,
                    submitted_at,
                    submitted_at,
                    outbox_error_class,
                    outbox_error_message,
                ),
            )
            connection.execute(
                """
                update local_reports
                set current_revision_id = ?, period_label = ?, updated_at = ?
                where report_id = ?
                """,
                (revision_id, reporting_period.label, submitted_at, report_id),
            )

        return {
            **summary,
            "report_id": report_id,
            "period_id": reporting_period.period_id,
            "period": reporting_period.label,
            "revision_id": revision_id,
            "revision_number": revision_number,
            "outbox_item_id": outbox_item_id,
            "payload_hash": payload_hash,
            "submitted_at": submitted_at,
            "sync_status": "pending_cloud_sync",
            "coverage": coverage,
        }

    def list_ready_sync_outbox_items(
        self,
        limit: int = 100,
        now: str | None = None,
    ) -> list[dict[str, Any]]:
        with self._connection() as connection:
            return list_ready_outbox_items(connection, limit=limit, now=now or _utc_now())

    def sync_outbox_health(self) -> dict[str, int | str | None]:
        with self._connection() as connection:
            return outbox_health(connection)

    def acknowledge_sync_outbox_item(
        self,
        outbox_item_id: str,
        acknowledgement: dict[str, Any] | None = None,
        acknowledged_at: str | None = None,
    ) -> bool:
        with self._connection(immediate=True) as connection:
            return acknowledge_outbox(
                connection,
                outbox_item_id=outbox_item_id,
                acknowledgement=acknowledgement or {},
                acknowledged_at=acknowledged_at or _utc_now(),
            )

    def record_sync_outbox_failure(
        self,
        outbox_item_id: str,
        *,
        error_class: str,
        error_message: str,
        retryable: bool,
        http_status: int | None = None,
        failed_at: str | None = None,
    ) -> dict[str, Any]:
        with self._connection(immediate=True) as connection:
            return record_outbox_failure(
                connection,
                outbox_item_id=outbox_item_id,
                error_class=error_class,
                error_message=error_message,
                retryable=retryable,
                http_status=http_status,
                failed_at=failed_at or _utc_now(),
            )

    def purge_report_raw_events(
        self,
        report_id: str,
        consolidated_revision_id: str,
    ) -> dict[str, int | str | None]:
        with self._connection(immediate=True) as connection:
            return purge_consolidated_report_raw_data(
                connection,
                report_id=report_id,
                consolidated_revision_id=consolidated_revision_id,
                purged_at=_utc_now(),
            )

    def retention_inventory(self) -> dict[str, Any]:
        with self._connection() as connection:
            return retention_inventory(connection, root=self._root)

    def prepare_mock_counts(
        self,
        *,
        mock_run_id: str,
        entries: int,
        exits: int,
        unique_count: int,
        peak_occupancy: int,
        camera_id: int | None,
        camera_name: str | None,
        period_id: str,
    ) -> dict[str, int | str | None]:
        reporting_period = monthly_period_from_id(period_id)
        if reporting_period is None:
            raise ValueError("Reporting period ID must use month:Asia/Manila:YYYY-MM.")
        with self._connection() as connection:
            existing_open_events = connection.execute(
                f"""
                select count(*)
                from count_events
                where mock_run_id = ?
                  and {_open_event_filter()}
                """,
                (mock_run_id,),
            ).fetchone()[0]
            existing_open_period = connection.execute(
                f"""
                select reporting_period_id
                from count_events
                where mock_run_id = ?
                  and {_open_event_filter()}
                order by recorded_at desc
                limit 1
                """,
                (mock_run_id,),
            ).fetchone()
            existing_period_report = connection.execute(
                """
                select count(*)
                from local_reports as report
                join local_report_revisions as revision
                  on revision.revision_id = report.current_revision_id
                where revision.mock_run_id = ?
                  and report.reporting_period_id = ?
                """,
                (mock_run_id, reporting_period.period_id),
            ).fetchone()[0]
        if existing_period_report or (
            existing_open_events
            and existing_open_period is not None
            and existing_open_period["reporting_period_id"] == reporting_period.period_id
        ):
            return {
                **self.metrics_summary(
                    include_submitted=False, period_id=reporting_period.period_id
                ),
                "prepared": False,
            }

        self._remove_mock_metric_data(mock_run_id)
        rng = random.Random(mock_run_id)
        entry_total = max(0, entries)
        exit_total = max(0, min(exits, entry_total))
        unique_total = max(0, min(unique_count, entry_total))
        peak_limit = max(1, peak_occupancy)
        start = reporting_period.starts_at_utc + timedelta(hours=1)
        available_seconds = max(
            1,
            int(
                (
                    reporting_period.ends_at_utc
                    - reporting_period.starts_at_utc
                    - timedelta(hours=2)
                ).total_seconds()
            ),
        )
        total = entry_total + exit_total
        remaining_entries = entry_total
        remaining_exits = exit_total
        current_entries = 0
        current_exits = 0
        occupancy = 0
        unique_remaining = unique_total
        rows: list[tuple[Any, ...]] = []

        for index in range(total):
            can_exit = remaining_exits > 0 and occupancy > 0
            must_exit = occupancy >= peak_limit and can_exit
            should_enter = (
                remaining_entries > 0 and not must_exit and (not can_exit or rng.random() < 0.58)
            )
            direction = "entry" if should_enter else "exit"
            if direction == "entry":
                remaining_entries -= 1
                current_entries += 1
                occupancy += 1
                is_unique = unique_remaining > 0
                unique_remaining -= 1 if is_unique else 0
                visitor_id = str(uuid4()) if is_unique and rng.random() < 0.86 else None
            else:
                remaining_exits -= 1
                current_exits += 1
                occupancy = max(0, occupancy - 1)
                is_unique = False
                visitor_id = None

            recorded_at = start + timedelta(
                seconds=(index + 1) * max(1, int(available_seconds / max(total, 1)))
            )
            business_date = recorded_at.astimezone(REPORTING_TIMEZONE).date().isoformat()
            event_id = str(uuid4())
            payload = {
                "camera_id": camera_id,
                "camera_name": camera_name,
                "direction": direction,
                "track_id": 200_000 + index,
                "visitor_id": visitor_id,
                "is_unique_entry": is_unique,
                "reid_score": round(rng.uniform(0.72, 0.96), 3) if visitor_id else None,
                "reid_decision": "new"
                if visitor_id
                else ("degraded_no_embedding" if is_unique else None),
                "identity_confidence": "high"
                if visitor_id
                else ("degraded" if is_unique else None),
                "source_kind": "mock",
                "mock_run_id": mock_run_id,
                "period": reporting_period.label,
                "period_id": reporting_period.period_id,
                "counts": {
                    "entry": current_entries,
                    "exit": current_exits,
                    "occupancy": occupancy,
                },
            }
            rows.append(
                (
                    event_id,
                    recorded_at.isoformat(),
                    business_date,
                    reporting_period.period_id,
                    camera_id,
                    camera_name,
                    direction,
                    200_000 + index,
                    current_entries,
                    current_exits,
                    occupancy,
                    visitor_id,
                    1 if is_unique else 0,
                    payload["reid_score"],
                    payload["reid_decision"],
                    payload["identity_confidence"],
                    _encode_event_attributes(payload),
                    "mock",
                    mock_run_id,
                )
            )

        with self._connection() as connection:
            upsert_reporting_period(connection, reporting_period)
            camera_key = local_camera_key(camera_id, camera_name)
            upsert_local_camera(
                connection,
                camera_key=camera_key,
                central_camera_id=None,
                local_camera_id=camera_id,
                display_name=camera_name,
                observed_at=reporting_period.starts_at_utc.isoformat(),
            )
            sequence_start = (
                allocate_camera_event_sequences(connection, camera_key, len(rows)) if rows else 0
            )
            sequenced_rows = [
                (*row[:4], camera_key, sequence_start + index, *row[4:])
                for index, row in enumerate(rows)
            ]
            connection.executemany(
                """
                    insert into count_events (
                        event_id, recorded_at, business_date, reporting_period_id,
                        camera_key, camera_event_sequence,
                        camera_id, camera_name, direction, track_id,
                    entry_count, exit_count, occupancy_count, visitor_id, is_unique_entry,
                    reid_score, reid_decision, identity_confidence,
                    payload_schema_version, attributes_json,
                    source_kind, mock_run_id
                )
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                    """,
                sequenced_rows,
            )
            for row in sequenced_rows:
                event_payload = json.loads(str(row[18]))
                record_metric_rollups(
                    connection,
                    event=event_payload,
                    captured_at=parse_captured_at(str(row[1])),
                    reporting_period=reporting_period,
                    business_date=str(row[2]),
                    camera_key=camera_key,
                )
        return {
            **self.metrics_summary(include_submitted=False, period_id=reporting_period.period_id),
            "prepared": True,
        }

    def _remove_mock_metric_data(self, mock_run_id: str) -> None:
        with self._connection() as connection:
            connection.execute(
                "delete from count_events where mock_run_id = ? and source_kind in ('mock', 'hybrid')",
                (mock_run_id,),
            )
            connection.execute(
                "delete from metric_rollups where mock_run_key = ?",
                (mock_run_id,),
            )
            connection.execute(
                """
                delete from occupancy_corrections
                where mock_run_id = ?
                  and source_kind in ('mock', 'hybrid')
                """,
                (mock_run_id,),
            )

    def remove_mock_data(self, mock_run_id: str | None = None) -> dict[str, int]:
        if mock_run_id:
            event_filter = "mock_run_id = ?"
            params: tuple[str, ...] = (mock_run_id,)
            report_filter = "revision.mock_run_id = ?"
        else:
            event_filter = "source_kind in ('mock', 'hybrid')"
            params = ()
            report_filter = "revision.source_kind in ('mock', 'hybrid')"

        with self._connection(immediate=True) as connection:
            count_events = connection.execute(
                f"select count(*) from count_events where {event_filter}", params
            ).fetchone()[0]
            occupancy_corrections = connection.execute(
                f"select count(*) from occupancy_corrections where {event_filter}", params
            ).fetchone()[0]
            report_rows = connection.execute(
                f"""
                select report.report_id
                from local_reports as report
                join local_report_revisions as revision
                  on revision.revision_id = report.current_revision_id
                where {report_filter}
                """,
                params,
            ).fetchall()
            report_ids = [str(row["report_id"]) for row in report_rows]
            restored_real_events = 0
            if report_ids:
                placeholders = ", ".join("?" for _ in report_ids)
                restored_real_events = connection.execute(
                    f"""
                    select count(distinct event.event_id)
                    from count_events as event
                    join local_report_event_memberships as membership
                      on membership.event_id = event.event_id
                    join local_report_revisions as revision
                      on revision.revision_id = membership.report_revision_id
                    where revision.report_id in ({placeholders})
                      and event.source_kind not in ('mock', 'hybrid')
                    """,
                    report_ids,
                ).fetchone()[0]
                connection.execute(
                    f"delete from local_reports where report_id in ({placeholders})",
                    report_ids,
                )
            connection.execute(f"delete from count_events where {event_filter}", params)
            connection.execute(f"delete from occupancy_corrections where {event_filter}", params)
            if mock_run_id:
                connection.execute(
                    "delete from metric_rollups where mock_run_key = ?",
                    (mock_run_id,),
                )
            else:
                connection.execute(
                    "delete from metric_rollups where source_kind in ('mock', 'hybrid')"
                )

        return {
            "count_events": _safe_int(count_events),
            "occupancy_corrections": _safe_int(occupancy_corrections),
            "local_reports": len(report_ids),
            "restored_real_events": _safe_int(restored_real_events),
        }

    def _local_report(self, report_id: str) -> dict[str, Any] | None:
        with self._connection() as connection:
            return self._local_report_from_connection(connection, report_id)

    def _local_report_from_connection(
        self, connection: sqlite3.Connection, report_id: str
    ) -> dict[str, Any] | None:
        row = connection.execute(
            f"""
            {_LOCAL_REPORT_SELECT}
            where report.report_id = ?
            """,
            (report_id,),
        ).fetchone()
        return _local_report_row(row) if row is not None else None

    def _local_report_for_period_from_connection(
        self, connection: sqlite3.Connection, period_id: str
    ) -> dict[str, Any] | None:
        row = connection.execute(
            f"""
            {_LOCAL_REPORT_SELECT}
            where report.reporting_period_id = ?
            order by revision.submitted_at desc
            limit 1
            """,
            (period_id,),
        ).fetchone()
        return _local_report_row(row) if row is not None else None

    def list_local_reports(self, limit: int = 100) -> list[dict[str, Any]]:
        limit = max(1, min(limit, 500))
        with self._connection() as connection:
            rows = connection.execute(
                f"""
                {_LOCAL_REPORT_SELECT}
                order by revision.submitted_at desc
                limit ?
                """,
                (limit,),
            ).fetchall()

        return [_local_report_row(row) for row in rows]

    @contextmanager
    def _connection(self, *, immediate: bool = False) -> Iterator[sqlite3.Connection]:
        self._initialize()
        with self._ledger_writer.transaction(immediate=immediate) as connection:
            yield connection

    def _write(self, operation_name: str, operation: Callable[[sqlite3.Connection], None]) -> None:
        self._initialize()

        def transaction() -> None:
            self._ledger_writer.instrumented_write(operation)

        retry_values: dict[str, Any] = {
            "policy": self._sqlite_retry_policy,
        }
        if self._retry_sleep is not None:
            retry_values["sleep"] = self._retry_sleep
        run_sqlite_write(operation_name, transaction, **retry_values)

    def persistence_instrumentation(self) -> dict[str, int]:
        return self._ledger_writer.instrumentation()

    def ensure_initialized(self) -> None:
        self._initialize()

    def _initialize(self) -> None:
        if self._initialized:
            return
        with self._initialize_lock:
            if self._initialized:
                return
            self._root.mkdir(parents=True, exist_ok=True)
            self._ledger_writer.initialize(enterprise_id=self._enterprise_id)
            self._initialized = True


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _encode_event_attributes(payload: dict[str, Any]) -> str:
    try:
        encoded = json.dumps(
            payload,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError) as exc:
        raise ValueError("Count-event attributes must contain only finite JSON values.") from exc
    if len(encoded.encode("utf-8")) > MAX_EVENT_ATTRIBUTES_BYTES:
        raise ValueError(f"Count-event attributes exceed {MAX_EVENT_ATTRIBUTES_BYTES} bytes.")
    return encoded


def _encode_runtime_snapshot(payload: dict[str, Any]) -> str:
    try:
        encoded = json.dumps(
            payload,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError) as exc:
        raise ValueError("Runtime snapshot must contain only finite JSON values.") from exc
    if len(encoded.encode("utf-8")) > 65_536:
        raise ValueError("Runtime snapshot must not exceed 65536 bytes.")
    return encoded


def _summary_with_report_metrics(
    summary: dict[str, Any], metrics: dict[str, Any]
) -> dict[str, Any]:
    entries = _safe_int(metrics.get("entries"))
    exits = min(_safe_int(metrics.get("exits")), entries)
    peak_occupancy = _safe_int(metrics.get("peak_occupancy", metrics.get("peakOccupancy")))
    unique_count = _safe_int(metrics.get("unique_count", metrics.get("uniqueCount")))
    return {
        **summary,
        "entries": entries,
        "exits": exits,
        "peak_occupancy": peak_occupancy,
        "current_occupancy": max(0, entries - exits),
        "unique_count": unique_count,
        "estimated_unique_count": unique_count,
    }


def _normalized_requested_metrics(metrics: dict[str, Any] | None) -> dict[str, int] | None:
    if metrics is None:
        return None
    entries = _safe_int(metrics.get("entries"))
    return {
        "entries": entries,
        "exits": min(_safe_int(metrics.get("exits")), entries),
        "peakOccupancy": _safe_int(metrics.get("peak_occupancy", metrics.get("peakOccupancy"))),
        "uniqueCount": _safe_int(metrics.get("unique_count", metrics.get("uniqueCount"))),
    }


def _source_batches_for_events(
    *,
    revision_id: str,
    period_id: str,
    event_rows: list[sqlite3.Row],
) -> list[dict[str, Any]]:
    groups: defaultdict[tuple[Any, ...], list[sqlite3.Row]] = defaultdict(list)
    for row in event_rows:
        groups[
            (
                row["camera_key"],
                row["camera_id"],
                row["camera_name"],
                str(row["source_kind"] or "real"),
                row["mock_run_id"],
            )
        ].append(row)

    batches: list[dict[str, Any]] = []
    for key, rows in sorted(
        groups.items(), key=lambda item: tuple(str(value or "") for value in item[0])
    ):
        camera_key, camera_id, camera_name, source_kind, mock_run_id = key
        if str(camera_key).startswith("unassigned:") and source_kind in {"real", "hybrid"}:
            raise ValueError(
                "Official camera events are not bound to a central camera UUID. "
                "Synchronize camera topology before report submission."
            )
        rows.sort(key=lambda row: int(row["camera_event_sequence"]))
        event_ids = [str(row["event_id"]) for row in rows]
        event_checksum = f"sha256:{canonical_hash(event_ids)}"
        sequences = [int(row["camera_event_sequence"]) for row in rows]
        sequence_start = min(sequences)
        sequence_end = max(sequences) + 1
        if sequence_end - sequence_start != len(sequences):
            raise ValueError(
                f"Camera event sequence for {camera_key} is not contiguous; "
                "the report was not created."
            )
        batch_id = str(uuid4())
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
                "period_id": period_id,
                "camera_id": camera_id,
                "camera_name": camera_name,
                "camera_key": camera_key,
                "source_kind": source_kind,
                "mock_run_id": mock_run_id,
                "sequence_start": sequence_start,
                "sequence_end": sequence_end,
                "first_event_at": rows[0]["recorded_at"],
                "last_event_at": rows[-1]["recorded_at"],
                "event_checksum": event_checksum,
                "event_rows": rows,
                "document": document,
            }
        )
    return batches


def _insert_source_batches_and_memberships(
    connection: sqlite3.Connection,
    *,
    report_id: str,
    revision_id: str,
    source_batches: list[dict[str, Any]],
    selected_at: str,
) -> None:
    for batch in source_batches:
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
        rows: list[sqlite3.Row] = batch["event_rows"]
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


def _report_revision_record(connection: sqlite3.Connection, revision_id: str) -> dict[str, Any]:
    row = connection.execute(
        f"""
        {_REPORT_REVISION_SELECT}
        where revision.revision_id = ?
        """,
        (revision_id,),
    ).fetchone()
    if row is None:
        raise RuntimeError(f"Local report revision disappeared: {revision_id}")
    return _local_report_row(row)


def _revision_response_from_record(
    connection: sqlite3.Connection, record: dict[str, Any]
) -> dict[str, int | str | None]:
    revision_id = str(record["revision_id"])
    event_count = connection.execute(
        """
        select count(*)
        from local_report_event_memberships
        where report_revision_id = ?
        """,
        (revision_id,),
    ).fetchone()[0]
    entries = _safe_int(record["entries"])
    exits = _safe_int(record["exits"])
    unique_count = _safe_int(record["unique_count"])
    reporting_period = monthly_period_from_id(str(record["period_id"]))
    if reporting_period is None:
        raise RuntimeError(
            f"Local report references an invalid reporting period: {record['period_id']}"
        )
    return {
        "entries": entries,
        "exits": exits,
        "peak_occupancy": _safe_int(record["peak_occupancy"]),
        "current_occupancy": max(0, entries - exits),
        "unique_count": unique_count,
        "estimated_unique_count": unique_count,
        "confirmed_unique_count": 0,
        "degraded_unique_count": 0,
        "pending_unique_entries": 0,
        "repeat_entry_count": max(0, entries - unique_count),
        "occupancy_correction_delta": 0,
        "total_events": _safe_int(event_count),
        "unsubmitted_events": 0,
        "unsynced_events": _safe_int(event_count) if record["sync_status"] != "synced" else 0,
        "unclassified_events": 0,
        "first_event_at": None,
        "last_event_at": None,
        "source_kind": str(record["source_kind"]),
        "mock_run_id": str(record["mock_run_id"]) if record["mock_run_id"] else None,
        "period_id": str(record["period_id"]) if record["period_id"] else None,
        "period": str(record["period"]),
        "starts_at_utc": reporting_period.starts_at_utc.isoformat(),
        "ends_at_utc": reporting_period.ends_at_utc.isoformat(),
        "business_start_date": reporting_period.business_start_date.isoformat(),
        "business_end_date_exclusive": (reporting_period.business_end_date_exclusive.isoformat()),
        "report_id": str(record["report_id"]),
        "revision_id": revision_id,
        "revision_number": _safe_int(record["revision_number"]),
        "outbox_item_id": str(record["outbox_item_id"]),
        "payload_hash": str(record["payload_hash"]),
        "submitted_at": str(record["submitted_at"]),
        "sync_status": str(record["sync_status"]),
    }


def _safe_scope(value: str | None) -> str:
    if not value:
        return "unbound"
    normalized = "".join(
        character if character.isalnum() or character in "._-" else "_"
        for character in value.strip()
    )
    return normalized[:160] or "unbound"


def _provenance_for_rows(rows: list[sqlite3.Row]) -> tuple[str, str | None]:
    if not rows:
        return "real", None
    source_kinds = {str(row["source_kind"]) for row in rows}
    run_ids = {str(row["mock_run_id"]) for row in rows if row["mock_run_id"]}
    if "hybrid" in source_kinds or ("real" in source_kinds and "mock" in source_kinds):
        source_kind = "hybrid"
    elif source_kinds == {"mock"}:
        source_kind = "mock"
    else:
        source_kind = "real"
    return source_kind, run_ids.pop() if len(run_ids) == 1 else None


def _open_event_filter(table_alias: str = "count_events") -> str:
    return (
        "not exists ("
        "select 1 from local_report_event_claims as claim "
        f"where claim.event_id = {table_alias}.event_id"
        ")"
    )


def _resolve_summary_period(
    connection: sqlite3.Connection,
    *,
    include_submitted: bool,
    requested_period_id: str | None,
) -> ReportingPeriod | None:
    if requested_period_id is not None:
        period = monthly_period_from_id(requested_period_id)
        if period is None:
            raise ValueError("Reporting period ID must use month:Asia/Manila:YYYY-MM.")
        return period

    submitted_filter = "" if include_submitted else f"and {_open_event_filter()}"
    row = connection.execute(
        f"""
        select reporting_period_id
        from count_events
        where reporting_period_id is not null
          {submitted_filter}
        order by recorded_at desc
        limit 1
        """
    ).fetchone()
    if row is None:
        if include_submitted:
            row = connection.execute(
                """
                select reporting_period_id
                from metric_rollups
                where grain = 'hour'
                order by bucket_start_at desc
                limit 1
                """
            ).fetchone()
        if row is not None:
            period = monthly_period_from_id(str(row["reporting_period_id"]))
            if period is None:
                raise RuntimeError(
                    "Local rollup references an invalid reporting period: "
                    f"{row['reporting_period_id']}"
                )
            return period
        return None
    period = monthly_period_from_id(str(row["reporting_period_id"]))
    if period is None:
        raise RuntimeError(
            f"Local event references an invalid reporting period: {row['reporting_period_id']}"
        )
    return period


def _safe_int(value: Any) -> int:
    return value if isinstance(value, int) else 0


def _safe_float(value: Any) -> float | None:
    if isinstance(value, int | float):
        return float(value)
    return None


def _parse_recorded_at(value: Any) -> datetime:
    if not isinstance(value, str):
        return datetime.fromtimestamp(0, UTC)

    try:
        return _normalize_datetime(datetime.fromisoformat(value))
    except ValueError:
        return datetime.fromtimestamp(0, UTC)


def _normalize_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


def _format_hour_label(value: datetime) -> str:
    hour = value.hour % 12 or 12
    suffix = "AM" if value.hour < 12 else "PM"
    return f"{hour} {suffix}"


def _format_day_label(value: datetime) -> str:
    return value.strftime("%a")


def _format_month_day_label(value: datetime) -> str:
    return f"{value.strftime('%b')} {value.day}"


def _trend_point(label: str, bucket: _MetricsBucket) -> dict[str, int | str]:
    return {
        "label": label,
        "visitors": bucket.unique,
        "entries": bucket.entries,
        "exits": bucket.exits,
        "peak_occupancy": bucket.peak_occupancy,
        "current_occupancy": bucket.current_occupancy,
    }


def _local_report_row(row: sqlite3.Row) -> dict[str, Any]:
    try:
        payload = json.loads(row["payload_json"]) if row["payload_json"] else {}
    except json.JSONDecodeError:
        payload = {}

    return {
        "report_id": row["report_id"],
        "revision_id": row["revision_id"],
        "revision_number": _safe_int(row["revision_number"]),
        "expected_version": _safe_int(row["expected_version"]),
        "last_acknowledged_logical_version": _safe_int(row["last_acknowledged_logical_version"]),
        "outbox_item_id": row["outbox_item_id"],
        "payload_hash": row["payload_hash"],
        "period": row["period"],
        "period_id": row["reporting_period_id"],
        "starts_at_utc": row["starts_at_utc"],
        "ends_at_utc": row["ends_at_utc"],
        "submitted_at": row["submitted_at"],
        "entries": _safe_int(row["entries"]),
        "exits": _safe_int(row["exits"]),
        "peak_occupancy": _safe_int(row["peak_occupancy"]),
        "unique_count": _safe_int(row["unique_count"]),
        "notes": row["notes"],
        "payload": payload if isinstance(payload, dict) else {},
        "sync_status": row["sync_status"],
        "source_kind": row["source_kind"],
        "mock_run_id": row["mock_run_id"],
        "synced_at": row["synced_at"],
        "raw_purged_at": row["raw_purged_at"],
    }
