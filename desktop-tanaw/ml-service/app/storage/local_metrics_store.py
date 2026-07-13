import json
import os
import random
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Any
from uuid import uuid4

from app.storage.local_schema import (
    connect_local_database,
    initialize_local_database,
    upsert_reporting_period,
)
from app.storage.reporting_periods import (
    REPORTING_TIMEZONE,
    ReportingPeriod,
    monthly_period_for_captured_at,
    monthly_period_from_id,
    monthly_period_from_label,
    parse_captured_at,
)

_REPORT_SUBMISSION_SELECT = """
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
"""


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


class LocalMetricsStore:
    def __init__(self, app_data_dir: str | None = None, enterprise_id: str | None = None) -> None:
        base_dir = app_data_dir or os.environ.get("TANAW_APP_DATA_DIR")
        if base_dir:
            root = Path(base_dir) / "ml-service"
        else:
            root = Path.home() / ".tanaw" / "ml-service"

        self._root = root / "enterprises" / _safe_scope(enterprise_id) if enterprise_id else root

        self._database_path = self._root / "tanaw_metrics.sqlite3"
        self._initialized = False
        self._initialize_lock = Lock()

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

        with self._connection() as connection:
            upsert_reporting_period(connection, reporting_period)
            connection.execute(
                """
                insert into count_events (
                    event_id,
                    recorded_at,
                    business_date,
                    reporting_period_id,
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
                    payload_json,
                    source_kind,
                    mock_run_id
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event_id,
                    captured_at.isoformat(),
                    business_date,
                    reporting_period.period_id,
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
                    json.dumps(payload, sort_keys=True),
                    payload.get("source_kind") or "real",
                    payload.get("mock_run_id"),
                ),
            )

        return event_id

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
        with self._connection() as connection:
            visitor_ids = [
                row["visitor_id"]
                for row in connection.execute(
                    """
                    select visitor_id
                    from visitor_identities
                    where expires_at <= ?
                    """,
                    (now,),
                ).fetchall()
            ]
            if not visitor_ids:
                return 0

            placeholders = ",".join("?" for _ in visitor_ids)
            connection.execute(
                f"delete from visitor_sightings where visitor_id in ({placeholders})", visitor_ids
            )
            connection.execute(
                f"delete from visitor_identities where visitor_id in ({placeholders})", visitor_ids
            )

        return len(visitor_ids)

    def save_count_snapshot(self, payload: dict[str, Any], recorded_at: str | None = None) -> None:
        raw_counts = payload.get("counts")
        counts: dict[str, Any] = raw_counts if isinstance(raw_counts, dict) else {}
        recorded_at = recorded_at or _utc_now()

        with self._connection() as connection:
            connection.execute(
                """
                insert into count_snapshots (
                    recorded_at,
                    camera_id,
                    camera_name,
                    entry_count,
                    exit_count,
                    occupancy_count,
                    running,
                    status,
                    error,
                    payload_json,
                    source_kind,
                    mock_run_id
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    recorded_at,
                    payload.get("camera_id"),
                    payload.get("camera_name"),
                    _safe_int(counts.get("entry")),
                    _safe_int(counts.get("exit")),
                    _safe_int(counts.get("occupancy")),
                    1 if payload.get("running") else 0,
                    payload.get("status"),
                    payload.get("error"),
                    json.dumps(payload, sort_keys=True),
                    payload.get("source_kind") or "real",
                    payload.get("mock_run_id"),
                ),
            )

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
    ) -> dict[str, int | str | None]:
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
    ) -> dict[str, int | str | None]:
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
            event_filter = f"submitted_report_id is null and {scope_filter}"
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
            where submitted_report_id is null
              and {scope_filter}
            """,
            params,
        ).fetchone()[0]
        unsynced_count = connection.execute(
            f"""
            select count(*)
            from count_events
            where synced_at is null
              and {scope_filter}
            """,
            params,
        ).fetchone()[0]
        unclassified_count = connection.execute(
            "select count(*) from count_events where reporting_period_id is null"
        ).fetchone()[0]
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
            conditions = [] if include_submitted else ["submitted_report_id is null"]
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

            month_buckets[(recorded_at.date() - month_start.date()).days].add_event(row)

            if recorded_at >= week_start:
                week_buckets[(recorded_at.date() - week_start.date()).days].add_event(row)

            if recorded_at.date() == today_start.date():
                hourly_buckets[recorded_at.hour].add_event(row)
                today_buckets[recorded_at.hour].add_event(row)

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

    def record_report_submission(
        self,
        report_id: str,
        period: str,
        notes: str | None = None,
        payload: dict[str, Any] | None = None,
        metrics: dict[str, Any] | None = None,
        source_kind: str | None = None,
        mock_run_id: str | None = None,
    ) -> dict[str, int | str | None]:
        submitted_at = _utc_now()
        report_payload = payload or {}
        payload_status = (
            report_payload.get("status") if isinstance(report_payload.get("status"), str) else None
        )
        with self._connection(immediate=True) as connection:
            existing_submission = self._report_submission_from_connection(connection, report_id)
            reporting_period = _resolve_report_period(
                connection,
                period=period,
                existing_submission=existing_submission,
            )
            upsert_reporting_period(connection, reporting_period)
            existing_period_submission = self._report_submission_for_period_from_connection(
                connection,
                reporting_period.period_id,
            )
            if (
                existing_period_submission is not None
                and existing_period_submission["report_id"] != report_id
            ):
                raise ValueError(
                    f"A report for {reporting_period.label} has already been submitted."
                )

            summary = self._metrics_summary(
                connection,
                include_submitted=False,
                period_id=reporting_period.period_id,
            )
            if existing_submission is not None and metrics is None:
                summary = {
                    **summary,
                    "entries": existing_submission["entries"],
                    "exits": existing_submission["exits"],
                    "peak_occupancy": existing_submission["peak_occupancy"],
                    "current_occupancy": max(
                        0, existing_submission["entries"] - existing_submission["exits"]
                    ),
                    "unique_count": existing_submission["unique_count"],
                }
            if metrics is not None:
                summary = _summary_with_report_metrics(summary, metrics)

            should_consume_open_events = (
                existing_submission is None and payload_status != "Resubmitted"
            )
            if should_consume_open_events:
                unclassified_official_events = connection.execute(
                    """
                    select count(*)
                    from count_events
                    where submitted_report_id is null
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
                str(existing_submission["source_kind"])
                if existing_submission is not None and existing_submission["source_kind"]
                else str(summary["source_kind"])
            )
            resolved_mock_run_id = mock_run_id or (
                str(existing_submission["mock_run_id"])
                if existing_submission is not None and existing_submission["mock_run_id"]
                else str(summary["mock_run_id"])
                if summary["mock_run_id"]
                else None
            )
            connection.execute(
                """
                insert into report_submissions (
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
                    mock_run_id
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                on conflict(report_id) do update set
                    period = excluded.period,
                    reporting_period_id = excluded.reporting_period_id,
                    submitted_at = excluded.submitted_at,
                    entries = excluded.entries,
                    exits = excluded.exits,
                    peak_occupancy = excluded.peak_occupancy,
                    unique_count = excluded.unique_count,
                    notes = excluded.notes,
                    payload_json = excluded.payload_json,
                    sync_status = excluded.sync_status,
                    source_kind = excluded.source_kind,
                    mock_run_id = excluded.mock_run_id,
                    synced_at = null
                """,
                (
                    report_id,
                    reporting_period.label,
                    reporting_period.period_id,
                    submitted_at,
                    summary["entries"],
                    summary["exits"],
                    summary["peak_occupancy"],
                    summary["unique_count"],
                    notes,
                    json.dumps(report_payload, sort_keys=True),
                    "pending_cloud_sync",
                    resolved_source_kind,
                    resolved_mock_run_id,
                ),
            )
            if should_consume_open_events:
                connection.execute(
                    """
                    update count_events
                    set submitted_report_id = ?
                    where submitted_report_id is null
                      and reporting_period_id = ?
                      and recorded_at >= ?
                      and recorded_at < ?
                    """,
                    (
                        report_id,
                        reporting_period.period_id,
                        reporting_period.starts_at_utc.isoformat(),
                        reporting_period.ends_at_utc.isoformat(),
                    ),
                )

        return {
            **summary,
            "report_id": report_id,
            "period_id": reporting_period.period_id,
            "period": reporting_period.label,
            "submitted_at": submitted_at,
            "sync_status": "pending_cloud_sync",
        }

    def mark_report_synced(self, report_id: str, synced_at: str | None = None) -> bool:
        synced_at = synced_at or _utc_now()
        with self._connection() as connection:
            result = connection.execute(
                """
                update report_submissions
                set sync_status = 'synced', synced_at = ?
                where report_id = ?
                """,
                (synced_at, report_id),
            )
        return result.rowcount > 0

    def purge_report_raw_events(self, report_id: str) -> dict[str, int | str | None]:
        purged_at = _utc_now()
        with self._connection() as connection:
            report = connection.execute(
                "select report_id, raw_purged_at from report_submissions where report_id = ?",
                (report_id,),
            ).fetchone()
            if report is None:
                return {
                    "report_id": report_id,
                    "purged_events": 0,
                    "raw_purged_at": None,
                }

            result = connection.execute(
                "delete from count_events where submitted_report_id = ?",
                (report_id,),
            )
            purged_events = result.rowcount or 0
            next_purged_at = (
                purged_at
                if purged_events > 0 or report["raw_purged_at"] is None
                else report["raw_purged_at"]
            )
            connection.execute(
                "update report_submissions set raw_purged_at = ? where report_id = ?",
                (next_purged_at, report_id),
            )

        return {
            "report_id": report_id,
            "purged_events": _safe_int(purged_events),
            "raw_purged_at": next_purged_at,
        }

    def mark_events_synced(self, synced_at: str | None = None) -> int:
        synced_at = synced_at or _utc_now()
        with self._connection() as connection:
            result = connection.execute(
                "update count_events set synced_at = ? where synced_at is null",
                (synced_at,),
            )
        return result.rowcount

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
        period: str,
    ) -> dict[str, int | str | None]:
        reporting_period = monthly_period_from_label(period)
        if reporting_period is None and period.strip().lower() == "current period":
            reporting_period = monthly_period_for_captured_at(datetime.now(UTC))
        if reporting_period is None:
            raise ValueError(
                "Simulation reporting period must identify one complete calendar month."
            )
        with self._connection() as connection:
            existing_open_events = connection.execute(
                """
                select count(*)
                from count_events
                where mock_run_id = ?
                  and submitted_report_id is null
                """,
                (mock_run_id,),
            ).fetchone()[0]
            existing_open_period = connection.execute(
                """
                select reporting_period_id
                from count_events
                where mock_run_id = ?
                  and submitted_report_id is null
                order by recorded_at desc
                limit 1
                """,
                (mock_run_id,),
            ).fetchone()
            existing_period_report = connection.execute(
                """
                select count(*)
                from report_submissions
                where mock_run_id = ?
                  and reporting_period_id = ?
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
                    json.dumps(payload, sort_keys=True),
                    "mock",
                    mock_run_id,
                )
            )

        with self._connection() as connection:
            upsert_reporting_period(connection, reporting_period)
            connection.executemany(
                """
                insert into count_events (
                    event_id, recorded_at, business_date, reporting_period_id,
                    camera_id, camera_name, direction, track_id,
                    entry_count, exit_count, occupancy_count, visitor_id, is_unique_entry,
                    reid_score, reid_decision, identity_confidence, payload_json,
                    source_kind, mock_run_id
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
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
                "delete from count_snapshots where mock_run_id = ? and source_kind in ('mock', 'hybrid')",
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
            preserved_event_filter = "(mock_run_id is null or mock_run_id != ?)"
            preserved_event_params: tuple[str, ...] = (mock_run_id,)
        else:
            event_filter = "source_kind in ('mock', 'hybrid')"
            params = ()
            preserved_event_filter = "source_kind not in ('mock', 'hybrid')"
            preserved_event_params = ()

        with self._connection() as connection:
            count_events = connection.execute(
                f"select count(*) from count_events where {event_filter}", params
            ).fetchone()[0]
            count_snapshots = connection.execute(
                f"select count(*) from count_snapshots where {event_filter}", params
            ).fetchone()[0]
            occupancy_corrections = connection.execute(
                f"select count(*) from occupancy_corrections where {event_filter}", params
            ).fetchone()[0]
            report_rows = connection.execute(
                f"select report_id from report_submissions where {event_filter}",
                params,
            ).fetchall()
            report_ids = [str(row["report_id"]) for row in report_rows]
            restored_real_events = 0
            if report_ids:
                placeholders = ", ".join("?" for _ in report_ids)
                restored_real_events = (
                    connection.execute(
                        f"""
                    update count_events
                    set submitted_report_id = null
                    where submitted_report_id in ({placeholders})
                      and {preserved_event_filter}
                    """,
                        (*report_ids, *preserved_event_params),
                    ).rowcount
                    or 0
                )
            connection.execute(f"delete from count_events where {event_filter}", params)
            connection.execute(f"delete from count_snapshots where {event_filter}", params)
            connection.execute(f"delete from report_submissions where {event_filter}", params)
            connection.execute(f"delete from occupancy_corrections where {event_filter}", params)

        return {
            "count_events": _safe_int(count_events),
            "count_snapshots": _safe_int(count_snapshots),
            "occupancy_corrections": _safe_int(occupancy_corrections),
            "report_submissions": len(report_ids),
            "restored_real_events": _safe_int(restored_real_events),
        }

    def _report_submission(self, report_id: str) -> dict[str, Any] | None:
        with self._connection() as connection:
            return self._report_submission_from_connection(connection, report_id)

    def _report_submission_from_connection(
        self, connection: sqlite3.Connection, report_id: str
    ) -> dict[str, Any] | None:
        row = connection.execute(
            f"""
            {_REPORT_SUBMISSION_SELECT}
            where report_id = ?
            """,
            (report_id,),
        ).fetchone()
        return _report_submission_row(row) if row is not None else None

    def _report_submission_for_period(self, period: str) -> dict[str, Any] | None:
        with self._connection() as connection:
            parsed_period = monthly_period_from_label(period)
            if parsed_period is not None:
                return self._report_submission_for_period_from_connection(
                    connection, parsed_period.period_id
                )
            row = connection.execute(
                f"""
                {_REPORT_SUBMISSION_SELECT}
                where reporting_period_id is null and period = ?
                order by submitted_at desc
                limit 1
                """,
                (period,),
            ).fetchone()
        return _report_submission_row(row) if row is not None else None

    def _report_submission_for_period_from_connection(
        self, connection: sqlite3.Connection, period_id: str
    ) -> dict[str, Any] | None:
        row = connection.execute(
            f"""
            {_REPORT_SUBMISSION_SELECT}
            where reporting_period_id = ?
            order by submitted_at desc
            limit 1
            """,
            (period_id,),
        ).fetchone()
        return _report_submission_row(row) if row is not None else None

    def list_report_submissions(self, limit: int = 100) -> list[dict[str, Any]]:
        limit = max(1, min(limit, 500))
        with self._connection() as connection:
            rows = connection.execute(
                f"""
                {_REPORT_SUBMISSION_SELECT}
                order by submitted_at desc
                limit ?
                """,
                (limit,),
            ).fetchall()

        return [_report_submission_row(row) for row in rows]

    @contextmanager
    def _connection(self, *, immediate: bool = False) -> Iterator[sqlite3.Connection]:
        self._initialize()
        connection = connect_local_database(self._database_path)
        try:
            if immediate:
                connection.execute("begin immediate")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self) -> None:
        if self._initialized:
            return
        with self._initialize_lock:
            if self._initialized:
                return
            self._root.mkdir(parents=True, exist_ok=True)
            initialize_local_database(self._database_path)
            self._initialized = True


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


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

    submitted_filter = "" if include_submitted else "and submitted_report_id is null"
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
        correction_row = connection.execute(
            """
            select recorded_at
            from occupancy_corrections
            order by recorded_at desc
            limit 1
            """
        ).fetchone()
        if correction_row is None:
            return None
        try:
            return monthly_period_for_captured_at(str(correction_row["recorded_at"]))
        except ValueError:
            return None
    period = monthly_period_from_id(str(row["reporting_period_id"]))
    if period is None:
        raise RuntimeError(
            f"Local event references an invalid reporting period: {row['reporting_period_id']}"
        )
    return period


def _resolve_report_period(
    connection: sqlite3.Connection,
    *,
    period: str,
    existing_submission: dict[str, Any] | None,
) -> ReportingPeriod:
    parsed_period = monthly_period_from_label(period)
    if parsed_period is not None:
        return parsed_period

    if existing_submission is not None and existing_submission.get("period_id"):
        existing_period = monthly_period_from_id(str(existing_submission["period_id"]))
        if existing_period is not None:
            return existing_period

    if period.strip().lower() != "current period":
        raise ValueError(
            "Reporting period must identify one complete calendar month; "
            "unrecognized labels are never assigned to the current month."
        )

    rows = connection.execute(
        """
        select distinct reporting_period_id
        from count_events
        where submitted_report_id is null
          and reporting_period_id is not null
        order by reporting_period_id
        """
    ).fetchall()
    period_ids = [str(row["reporting_period_id"]) for row in rows]
    if len(period_ids) != 1:
        raise ValueError(
            "Current Period is ambiguous. Select an explicit reporting month; "
            f"found {len(period_ids)} open reporting periods."
        )
    resolved = monthly_period_from_id(period_ids[0])
    if resolved is None:
        raise RuntimeError(f"Local event references an invalid reporting period: {period_ids[0]}")
    return resolved


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


def _report_submission_row(row: sqlite3.Row) -> dict[str, Any]:
    try:
        payload = json.loads(row["payload_json"]) if row["payload_json"] else {}
    except json.JSONDecodeError:
        payload = {}

    return {
        "report_id": row["report_id"],
        "period": row["period"],
        "period_id": row["reporting_period_id"],
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
