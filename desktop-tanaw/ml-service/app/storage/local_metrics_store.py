import json
import os
import random
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4


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

    def append_count_event(self, payload: dict[str, Any], recorded_at: str | None = None) -> str:
        event_id = str(uuid4())
        recorded_at = recorded_at or _utc_now()
        raw_counts = payload.get("counts")
        counts: dict[str, Any] = raw_counts if isinstance(raw_counts, dict) else {}
        direction = payload.get("direction")
        is_unique_entry = payload.get("is_unique_entry")
        if is_unique_entry is None:
            is_unique_entry = direction == "entry"

        with self._connection() as connection:
            connection.execute(
                """
                insert into count_events (
                    event_id,
                    recorded_at,
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
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event_id,
                    recorded_at,
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

    def metrics_summary(self, include_submitted: bool = False) -> dict[str, int | str | None]:
        submitted_filter = "" if include_submitted else "where submitted_report_id is null"
        with self._connection() as connection:
            row = connection.execute(
                f"""
                select
                    count(*) as total_events,
                    sum(case when direction = 'entry' then 1 else 0 end) as entries,
                    sum(case when direction = 'exit' then 1 else 0 end) as exits,
                    sum(case when direction = 'entry' and is_unique_entry = 1 then 1 else 0 end) as unique_entries,
                    sum(case when direction = 'entry' and is_unique_entry = 1 and visitor_id is not null and visitor_id != '' then 1 else 0 end) as confirmed_unique_entries,
                    sum(case when direction = 'entry' and is_unique_entry = 1 and (visitor_id is null or visitor_id = '') then 1 else 0 end) as degraded_unique_entries,
                    max(occupancy_count) as peak_occupancy,
                    max(occupancy_count) as current_occupancy,
                    min(recorded_at) as first_event_at,
                    max(recorded_at) as last_event_at
                from count_events
                {submitted_filter}
                """
            ).fetchone()

            unsynced_count = connection.execute(
                "select count(*) from count_events where synced_at is null"
            ).fetchone()[0]
            unsubmitted_count = connection.execute(
                "select count(*) from count_events where submitted_report_id is null"
            ).fetchone()[0]
            source_rows = connection.execute(
                f"""
                select distinct source_kind, mock_run_id
                from count_events
                {submitted_filter}
                """
            ).fetchall()
            correction_row = connection.execute(
                """
                select coalesce(sum(delta), 0) as correction_delta
                from occupancy_corrections
                """
            ).fetchone()

        entries = _safe_int(row["entries"])
        exits = _safe_int(row["exits"])
        correction_delta = _safe_int(correction_row["correction_delta"])
        current_occupancy = max(0, entries - exits + correction_delta)
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
            "occupancy_correction_delta": correction_delta,
            "total_events": _safe_int(row["total_events"]),
            "unsubmitted_events": _safe_int(unsubmitted_count),
            "unsynced_events": _safe_int(unsynced_count),
            "first_event_at": row["first_event_at"],
            "last_event_at": row["last_event_at"],
            "source_kind": source_kind,
            "mock_run_id": mock_run_id,
        }

    def metrics_history(
        self, include_submitted: bool = False, now: datetime | None = None
    ) -> dict[str, Any]:
        now = _normalize_datetime(now or datetime.now().astimezone())
        local_timezone = now.tzinfo or UTC
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today_start - timedelta(days=6)
        month_start = today_start - timedelta(days=29)

        with self._connection() as connection:
            rows = connection.execute(
                f"""
                select recorded_at, direction, occupancy_count, is_unique_entry
                from count_events
                {_submitted_filter_sql(include_submitted)}
                order by recorded_at asc
                """
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
        source_kind: str | None = None,
        mock_run_id: str | None = None,
    ) -> dict[str, int | str | None]:
        submitted_at = _utc_now()
        summary = self.metrics_summary(include_submitted=False)
        existing_submission = self._report_submission(report_id)
        existing_period_submission = self._report_submission_for_period(period)
        if (
            existing_period_submission is not None
            and existing_period_submission["report_id"] != report_id
        ):
            raise ValueError(f"A report for {period} has already been submitted.")
        if existing_submission is not None and summary["unsubmitted_events"] == 0:
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
        report_payload = payload or {}
        resolved_source_kind = source_kind or str(summary["source_kind"])
        resolved_mock_run_id = mock_run_id or (
            str(summary["mock_run_id"]) if summary["mock_run_id"] else None
        )

        with self._connection() as connection:
            connection.execute(
                """
                insert or replace into report_submissions (
                    report_id,
                    period,
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
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    report_id,
                    period,
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
            connection.execute(
                """
                update count_events
                set submitted_report_id = ?
                where submitted_report_id is null
                """,
                (report_id,),
            )

        return {
            **summary,
            "report_id": report_id,
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
        with self._connection() as connection:
            existing_events = connection.execute(
                "select count(*) from count_events where mock_run_id = ?",
                (mock_run_id,),
            ).fetchone()[0]
            existing_reports = connection.execute(
                "select count(*) from report_submissions where mock_run_id = ?",
                (mock_run_id,),
            ).fetchone()[0]
        if existing_events or existing_reports:
            return {
                **self.metrics_summary(include_submitted=False),
                "prepared": False,
            }

        self.remove_mock_data()
        rng = random.Random(mock_run_id)
        entry_total = max(0, entries)
        exit_total = max(0, min(exits, entry_total))
        unique_total = max(0, min(unique_count, entry_total))
        peak_limit = max(1, peak_occupancy)
        start = datetime.now(UTC) - timedelta(days=20)
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

            recorded_at = (
                start + timedelta(seconds=(index + 1) * max(1, int((20 * 86400) / max(total, 1))))
            ).isoformat()
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
                "period": period,
                "counts": {
                    "entry": current_entries,
                    "exit": current_exits,
                    "occupancy": occupancy,
                },
            }
            rows.append(
                (
                    event_id,
                    recorded_at,
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
            connection.executemany(
                """
                insert into count_events (
                    event_id, recorded_at, camera_id, camera_name, direction, track_id,
                    entry_count, exit_count, occupancy_count, visitor_id, is_unique_entry,
                    reid_score, reid_decision, identity_confidence, payload_json,
                    source_kind, mock_run_id
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
        return {
            **self.metrics_summary(include_submitted=False),
            "prepared": True,
        }

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
            row = connection.execute(
                """
                select
                    report_id,
                    period,
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
                    synced_at
                from report_submissions
                where report_id = ?
                """,
                (report_id,),
            ).fetchone()

        return _report_submission_row(row) if row is not None else None

    def _report_submission_for_period(self, period: str) -> dict[str, Any] | None:
        with self._connection() as connection:
            row = connection.execute(
                """
                select
                    report_id,
                    period,
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
                    synced_at
                from report_submissions
                where period = ?
                order by submitted_at desc
                limit 1
                """,
                (period,),
            ).fetchone()
        return _report_submission_row(row) if row is not None else None

    def list_report_submissions(self, limit: int = 100) -> list[dict[str, Any]]:
        limit = max(1, min(limit, 500))
        with self._connection() as connection:
            rows = connection.execute(
                """
                select
                    report_id,
                    period,
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
                    synced_at
                from report_submissions
                order by submitted_at desc
                limit ?
                """,
                (limit,),
            ).fetchall()

        return [_report_submission_row(row) for row in rows]

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        self._initialize()
        connection = sqlite3.connect(self._database_path)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("pragma foreign_keys = on")
            yield connection
            connection.commit()
        finally:
            connection.close()

    def _initialize(self) -> None:
        if self._initialized:
            return

        self._root.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self._database_path)
        connection.row_factory = sqlite3.Row
        try:
            connection.executescript(
                """
                create table if not exists count_events (
                    id integer primary key autoincrement,
                    event_id text not null unique,
                    recorded_at text not null,
                    camera_id integer,
                    camera_name text,
                    direction text not null check (direction in ('entry', 'exit')),
                    track_id integer,
                    entry_count integer not null default 0,
                    exit_count integer not null default 0,
                    occupancy_count integer not null default 0,
                    visitor_id text,
                    is_unique_entry integer not null default 0,
                    reid_score real,
                    reid_decision text,
                    identity_confidence text,
                    source_kind text not null default 'real',
                    mock_run_id text,
                    payload_json text not null,
                    submitted_report_id text,
                    synced_at text
                );

                create index if not exists idx_count_events_recorded_at on count_events(recorded_at);
                create index if not exists idx_count_events_submitted_report_id on count_events(submitted_report_id);
                create index if not exists idx_count_events_synced_at on count_events(synced_at);

                create table if not exists count_snapshots (
                    id integer primary key autoincrement,
                    recorded_at text not null,
                    camera_id integer,
                    camera_name text,
                    entry_count integer not null default 0,
                    exit_count integer not null default 0,
                    occupancy_count integer not null default 0,
                    running integer not null default 0,
                    status text,
                    error text,
                    source_kind text not null default 'real',
                    mock_run_id text,
                    payload_json text not null
                );

                create index if not exists idx_count_snapshots_recorded_at on count_snapshots(recorded_at);

                create table if not exists report_submissions (
                    report_id text primary key,
                    period text not null,
                    submitted_at text not null,
                    entries integer not null default 0,
                    exits integer not null default 0,
                    peak_occupancy integer not null default 0,
                    unique_count integer not null default 0,
                    notes text,
                    payload_json text not null,
                    sync_status text not null default 'pending_cloud_sync',
                    source_kind text not null default 'real',
                    mock_run_id text,
                    synced_at text
                );

                create table if not exists occupancy_corrections (
                    correction_id text primary key,
                    enterprise_id text,
                    camera_id integer,
                    old_occupancy integer not null default 0,
                    new_occupancy integer not null default 0,
                    delta integer not null default 0,
                    reason text not null,
                    actor_id text,
                    actor_name text,
                    source_kind text not null default 'real',
                    mock_run_id text,
                    recorded_at text not null,
                    payload_json text not null
                );

                create index if not exists idx_occupancy_corrections_recorded_at
                    on occupancy_corrections(recorded_at);
                create index if not exists idx_occupancy_corrections_source
                    on occupancy_corrections(source_kind, mock_run_id);

                create table if not exists visitor_identities (
                    visitor_id text primary key,
                    business_date text not null,
                    camera_id integer,
                    first_seen_at text not null,
                    last_seen_at text not null,
                    representative_embedding blob not null,
                    embedding_dim integer not null,
                    embedding_count integer not null default 1,
                    model_name text not null,
                    expires_at text not null
                );

                create index if not exists idx_visitor_identities_business_date on visitor_identities(business_date);
                create index if not exists idx_visitor_identities_expires_at on visitor_identities(expires_at);

                create table if not exists visitor_model_embeddings (
                    visitor_id text not null,
                    model_name text not null,
                    representative_embedding blob not null,
                    embedding_dim integer not null,
                    embedding_count integer not null default 1,
                    updated_at text not null,
                    primary key (visitor_id, model_name),
                    foreign key (visitor_id) references visitor_identities(visitor_id) on delete cascade
                );

                create index if not exists idx_visitor_model_embeddings_model on visitor_model_embeddings(model_name);

                create table if not exists visitor_sightings (
                    sighting_id text primary key,
                    visitor_id text not null,
                    recorded_at text not null,
                    business_date text not null,
                    camera_id integer,
                    track_id integer,
                    direction text not null check (direction in ('entry', 'exit')),
                    reid_score real,
                    reid_decision text not null,
                    identity_confidence text not null,
                    detection_confidence real,
                    bbox_json text,
                    payload_json text not null,
                    foreign key (visitor_id) references visitor_identities(visitor_id)
                );

                create index if not exists idx_visitor_sightings_business_date on visitor_sightings(business_date);
                """
            )
            _ensure_column(connection, "count_events", "visitor_id", "text")
            _ensure_column(
                connection, "count_events", "is_unique_entry", "integer not null default 0"
            )
            _ensure_column(connection, "count_events", "reid_score", "real")
            _ensure_column(connection, "count_events", "reid_decision", "text")
            _ensure_column(connection, "count_events", "identity_confidence", "text")
            _ensure_column(
                connection, "count_events", "source_kind", "text not null default 'real'"
            )
            _ensure_column(connection, "count_events", "mock_run_id", "text")
            _ensure_column(
                connection, "count_snapshots", "source_kind", "text not null default 'real'"
            )
            _ensure_column(connection, "count_snapshots", "mock_run_id", "text")
            _ensure_column(
                connection, "report_submissions", "source_kind", "text not null default 'real'"
            )
            _ensure_column(connection, "report_submissions", "mock_run_id", "text")
            _ensure_column(connection, "occupancy_corrections", "enterprise_id", "text")
            _ensure_column(
                connection,
                "occupancy_corrections",
                "source_kind",
                "text not null default 'real'",
            )
            _ensure_column(connection, "occupancy_corrections", "mock_run_id", "text")
            connection.execute(
                """
                update count_events
                set is_unique_entry = 1
                where direction = 'entry'
                    and reid_decision is null
                    and (visitor_id is null or visitor_id = '')
                    and is_unique_entry = 0
                """
            )
            connection.commit()
        finally:
            connection.close()

        self._initialized = True


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


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


def _submitted_filter_sql(include_submitted: bool) -> str:
    return "" if include_submitted else "where submitted_report_id is null"


def _safe_int(value: Any) -> int:
    return value if isinstance(value, int) else 0


def _safe_float(value: Any) -> float | None:
    if isinstance(value, int | float):
        return float(value)
    return None


def _ensure_column(
    connection: sqlite3.Connection, table_name: str, column_name: str, definition: str
) -> None:
    existing_columns = {
        row["name"] for row in connection.execute(f"pragma table_info({table_name})").fetchall()
    }
    if column_name in existing_columns:
        return

    connection.execute(f"alter table {table_name} add column {column_name} {definition}")


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
    }
