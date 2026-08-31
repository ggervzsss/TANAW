import json
import logging
import random
import sqlite3
from contextlib import AbstractContextManager
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from app.config.report_config import reporting_period_key
from app.storage.local_data_serialization import (
    _camera_breakdown_row,
    _format_day_label,
    _format_hour_label,
    _format_month_day_label,
    _MetricsBucket,
    _normalize_datetime,
    _parse_recorded_at,
    _period_for_payload_rows,
    _report_submission_row,
    _safe_float,
    _safe_int,
    _submitted_filter_sql,
    _summary_with_report_metrics,
    _trend_point,
    _utc_now,
)
from app.storage.local_database import LocalDatabase
from app.storage.repositories.camera_repository import CameraRepository
from app.storage.repositories.report_draft_repository import ReportDraftRepository
from app.storage.repositories.visitor_identity_repository import VisitorIdentityRepository

logger = logging.getLogger(__name__)


class LocalDataStore:
    def __init__(self, app_data_dir: str | None = None, enterprise_id: str | None = None) -> None:
        self._enterprise_id = enterprise_id
        self._database = LocalDatabase(app_data_dir, enterprise_id)
        self._cameras = CameraRepository(self._database)
        self._report_drafts = ReportDraftRepository(self._database)
        self._visitor_identities = VisitorIdentityRepository(self._database)
        self._root = self._database.root
        self._database_path = self._database.path

    def load_monitoring_state(self, camera_id: int | None = None) -> dict[str, Any] | None:
        return self._cameras.load_monitoring_state(camera_id)

    def list_monitoring_states(self) -> list[dict[str, Any]]:
        return self._cameras.list_monitoring_states()

    def save_monitoring_state(
        self, payload: dict[str, Any], updated_at: str | None = None
    ) -> dict[str, Any]:
        return self._cameras.save_monitoring_state(payload, updated_at)

    def list_camera_profiles(self) -> list[dict[str, Any]]:
        return self._cameras.list_profiles()

    def replace_camera_profiles(self, cameras: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self._cameras.replace_profiles(cameras)

    def append_count_event(self, payload: dict[str, Any], recorded_at: str | None = None) -> str:
        supplied_event_id = payload.get("event_id")
        event_id = supplied_event_id.strip() if isinstance(supplied_event_id, str) else str(uuid4())
        recorded_at = recorded_at or _utc_now()
        raw_counts = payload.get("counts")
        counts: dict[str, Any] = raw_counts if isinstance(raw_counts, dict) else {}
        direction = payload.get("direction")
        is_unique_entry = payload.get("is_unique_entry")
        if is_unique_entry is None:
            is_unique_entry = direction == "entry"

        with self._connection() as connection:
            # Serialize the enterprise-wide read/modify/write across independent
            # camera pipeline connections so simultaneous events cannot lose an
            # occupancy increment.
            connection.execute("begin immediate")
            current_occupancy = self._ensure_enterprise_occupancy_state(connection)
            cursor = connection.execute(
                """
                insert or ignore into count_events (
                    event_id,
                    recorded_at,
                    enterprise_id,
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
                    enterprise_occupancy_count,
                    payload_json
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?)
                """,
                (
                    event_id,
                    recorded_at,
                    payload.get("enterprise_id", self._enterprise_id),
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
                ),
            )
            if cursor.rowcount > 0:
                delta = 1 if direction == "entry" else -1
                next_occupancy = max(0, current_occupancy + delta)
                if direction == "exit" and current_occupancy == 0:
                    logger.warning(
                        "Enterprise occupancy remained at zero for an unmatched exit event.",
                        extra={
                            "enterprise_id": payload.get("enterprise_id", self._enterprise_id),
                            "camera_id": payload.get("camera_id"),
                            "event_id": event_id,
                        },
                    )
                connection.execute(
                    """
                    update enterprise_occupancy_state
                    set current_occupancy = ?,
                        peak_occupancy = max(peak_occupancy, ?),
                        updated_at = ?
                    where singleton_id = 1
                    """,
                    (next_occupancy, next_occupancy, recorded_at),
                )
                connection.execute(
                    "update count_events set enterprise_occupancy_count = ? where event_id = ?",
                    (next_occupancy, event_id),
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
        identity_status: str = "confirmed",
        canonical_visitor_id: str | None = None,
        recorded_at: str | None = None,
    ) -> None:
        self._visitor_identities.upsert_identity(
            visitor_id=visitor_id,
            business_date=business_date,
            camera_id=camera_id,
            embedding=embedding,
            embedding_dim=embedding_dim,
            embedding_count=embedding_count,
            model_name=model_name,
            expires_at=expires_at,
            identity_status=identity_status,
            canonical_visitor_id=canonical_visitor_id,
            recorded_at=recorded_at,
        )

    def upsert_visitor_identity_prototype(
        self,
        *,
        visitor_id: str,
        model_name: str,
        prototype_index: int,
        embedding: bytes,
        embedding_dim: int,
        embedding_count: int,
        recorded_at: str | None = None,
    ) -> None:
        self._visitor_identities.upsert_prototype(
            visitor_id=visitor_id,
            model_name=model_name,
            prototype_index=prototype_index,
            embedding=embedding,
            embedding_dim=embedding_dim,
            embedding_count=embedding_count,
            recorded_at=recorded_at,
        )

    def resolve_visitor_identity(
        self,
        visitor_id: str,
        *,
        identity_status: str,
        canonical_visitor_id: str | None = None,
        recorded_at: str | None = None,
    ) -> None:
        self._visitor_identities.resolve(
            visitor_id,
            identity_status=identity_status,
            canonical_visitor_id=canonical_visitor_id,
            recorded_at=recorded_at,
        )

    def restore_visitor_identity(
        self,
        visitor_id: str,
        *,
        recorded_at: str | None = None,
    ) -> bool:
        return self._visitor_identities.restore(visitor_id, recorded_at=recorded_at)

    def append_visitor_sighting(
        self, payload: dict[str, Any], recorded_at: str | None = None
    ) -> str:
        return self._visitor_identities.append_sighting(payload, recorded_at)

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
        self._visitor_identities.upsert_model_embedding(
            visitor_id=visitor_id,
            model_name=model_name,
            embedding=embedding,
            embedding_dim=embedding_dim,
            embedding_count=embedding_count,
            recorded_at=recorded_at,
        )

    def load_active_visitor_identities(
        self, business_date: str, now: str | None = None
    ) -> list[dict[str, Any]]:
        return self._visitor_identities.load_active_identities(business_date, now)

    def load_active_visitor_identity_prototypes(
        self,
        business_date: str,
        model_name: str,
        now: str | None = None,
    ) -> list[dict[str, Any]]:
        return self._visitor_identities.load_active_prototypes(business_date, model_name, now)

    def load_active_visitor_model_embeddings(
        self,
        business_date: str,
        model_name: str,
        now: str | None = None,
    ) -> list[dict[str, Any]]:
        return self._visitor_identities.load_active_model_embeddings(business_date, model_name, now)

    def cleanup_expired_visitor_metadata(self, now: str | None = None) -> int:
        return self._visitor_identities.cleanup_expired(now)

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
        recorded_at: str | None = None,
    ) -> dict[str, Any]:
        correction_id = str(uuid4())
        recorded_at = recorded_at or _utc_now()
        with self._connection() as connection:
            connection.execute("begin immediate")
            authoritative_old_occupancy = self._ensure_enterprise_occupancy_state(connection)
            normalized_new_occupancy = max(0, new_occupancy)
            delta = normalized_new_occupancy - authoritative_old_occupancy
            payload = {
                "correction_id": correction_id,
                "enterprise_id": enterprise_id,
                "camera_id": camera_id,
                "old_occupancy": authoritative_old_occupancy,
                "new_occupancy": normalized_new_occupancy,
                "delta": delta,
                "reason": reason,
                "actor_id": actor_id,
                "actor_name": actor_name,
                "recorded_at": recorded_at,
            }
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
                    recorded_at,
                    payload_json
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    recorded_at,
                    json.dumps(payload, sort_keys=True),
                ),
            )
            connection.execute(
                """
                update enterprise_occupancy_state
                set current_occupancy = ?,
                    peak_occupancy = max(peak_occupancy, ?),
                    updated_at = ?
                where singleton_id = 1
                """,
                (normalized_new_occupancy, normalized_new_occupancy, recorded_at),
            )

        return payload

    def enterprise_occupancy(self) -> int:
        with self._connection() as connection:
            return self._ensure_enterprise_occupancy_state(connection)

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
                    recorded_at
                from occupancy_corrections
                order by recorded_at desc
                limit ?
                """,
                (limit,),
            ).fetchall()

        return [dict(row) for row in rows]

    def metrics_summary(
        self, include_submitted: bool = False, camera_id: int | None = None
    ) -> dict[str, int | str | None]:
        conditions = [] if include_submitted else ["submitted_report_id is null"]
        parameters: tuple[Any, ...] = ()
        if camera_id is not None:
            conditions.append("camera_id = ?")
            parameters = (camera_id,)
        submitted_filter = f"where {' and '.join(conditions)}" if conditions else ""
        camera_filter = " and camera_id = ?" if camera_id is not None else ""
        with self._connection() as connection:
            row = connection.execute(
                f"""
                select
                    count(*) as total_events,
                    sum(case when direction = 'entry' then 1 else 0 end) as entries,
                    sum(case when direction = 'exit' then 1 else 0 end) as exits,
                    sum(case when direction = 'entry' and is_unique_entry = 1 then 1 else 0 end) as unique_entries,
                    sum(case when direction = 'entry' and is_unique_entry = 1 and identity_confidence = 'high' then 1 else 0 end) as confirmed_unique_entries,
                    sum(case when direction = 'entry' and is_unique_entry = 1 and coalesce(identity_confidence, 'degraded') != 'high' then 1 else 0 end) as degraded_unique_entries,
                    sum(
                        case
                            when direction = 'entry'
                                and is_unique_entry = 0
                                and reid_decision = 'ambiguous_new'
                                and exists (
                                    select 1
                                    from visitor_identities
                                    where visitor_identities.visitor_id = count_events.visitor_id
                                        and visitor_identities.identity_status = 'provisional'
                                )
                            then 1
                            else 0
                        end
                    ) as pending_unique_entries,
                    max(occupancy_count) as peak_occupancy,
                    max(enterprise_occupancy_count) as enterprise_peak_occupancy,
                    min(recorded_at) as first_event_at,
                    max(recorded_at) as last_event_at
                from count_events
                {submitted_filter}
                """,
                parameters,
            ).fetchone()

            unsynced_count = connection.execute(
                f"select count(*) from count_events where synced_at is null{camera_filter}",
                parameters if camera_id is not None else (),
            ).fetchone()[0]
            unsubmitted_count = connection.execute(
                f"select count(*) from count_events where submitted_report_id is null{camera_filter}",
                parameters if camera_id is not None else (),
            ).fetchone()[0]
            payload_rows = connection.execute(
                f"""
                select payload_json
                from count_events
                {submitted_filter}
                order by recorded_at asc
                limit 25
                """,
                parameters,
            ).fetchall()
            occupancy_rows = connection.execute(
                f"""
                select camera_id, occupancy_count
                from count_events
                {submitted_filter}
                order by recorded_at asc, id asc
                """,
                parameters,
            ).fetchall()
            correction_row = connection.execute(
                f"""
                select coalesce(sum(delta), 0) as correction_delta
                from occupancy_corrections
                {"where camera_id = ?" if camera_id is not None else ""}
                """,
                parameters if camera_id is not None else (),
            ).fetchone()
            enterprise_state = connection.execute(
                """
                select current_occupancy, peak_occupancy
                from enterprise_occupancy_state
                where singleton_id = 1
                """
            ).fetchone()

        entries = _safe_int(row["entries"])
        exits = _safe_int(row["exits"])
        correction_delta = _safe_int(correction_row["correction_delta"])
        current_occupancy = max(0, entries - exits + correction_delta)
        occupancy_by_camera: dict[int | str, int] = {}
        enterprise_peak_occupancy = 0
        for occupancy_row in occupancy_rows:
            camera_scope: int | str = (
                int(occupancy_row["camera_id"])
                if occupancy_row["camera_id"] is not None
                else "unattributed"
            )
            occupancy_by_camera[camera_scope] = max(0, _safe_int(occupancy_row["occupancy_count"]))
            enterprise_peak_occupancy = max(
                enterprise_peak_occupancy, sum(occupancy_by_camera.values())
            )
        estimated_unique_count = _safe_int(row["unique_entries"])
        pending_unique_entries = _safe_int(row["pending_unique_entries"])
        if camera_id is None and enterprise_state is not None:
            current_occupancy = max(0, _safe_int(enterprise_state["current_occupancy"]))
        recorded_enterprise_peak = _safe_int(row["enterprise_peak_occupancy"])
        if include_submitted and enterprise_state is not None:
            recorded_enterprise_peak = max(
                recorded_enterprise_peak, _safe_int(enterprise_state["peak_occupancy"])
            )
        return {
            "entries": entries,
            "exits": exits,
            "peak_occupancy": max(
                enterprise_peak_occupancy,
                recorded_enterprise_peak,
                _safe_int(row["peak_occupancy"]),
                current_occupancy,
            ),
            "current_occupancy": current_occupancy,
            "unique_count": estimated_unique_count,
            "estimated_unique_count": estimated_unique_count,
            "confirmed_unique_count": _safe_int(row["confirmed_unique_entries"]),
            "degraded_unique_count": _safe_int(row["degraded_unique_entries"]),
            "pending_unique_entries": pending_unique_entries,
            "repeat_entry_count": max(0, entries - estimated_unique_count - pending_unique_entries),
            "occupancy_correction_delta": correction_delta,
            "total_events": _safe_int(row["total_events"]),
            "unsubmitted_events": _safe_int(unsubmitted_count),
            "unsynced_events": _safe_int(unsynced_count),
            "first_event_at": row["first_event_at"],
            "last_event_at": row["last_event_at"],
            "period": _period_for_payload_rows(payload_rows),
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
                select
                    recorded_at,
                    direction,
                    coalesce(enterprise_occupancy_count, occupancy_count) as occupancy_count,
                    is_unique_entry
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
        metrics: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        submitted_at = _utc_now()
        summary = self.metrics_summary(include_submitted=False)
        existing_submission = self._report_submission(report_id)
        existing_period_submission = self._report_submission_for_period(period)
        if (
            existing_period_submission is not None
            and existing_period_submission["report_id"] != report_id
        ):
            raise ValueError(f"A report for {period} has already been submitted.")
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
        report_payload = payload or {}
        payload_status = (
            report_payload.get("status") if isinstance(report_payload.get("status"), str) else None
        )
        open_period = summary.get("period")
        open_period_key = (
            reporting_period_key(open_period) if isinstance(open_period, str) else None
        )
        submission_period_key = reporting_period_key(period)
        open_period_matches_submission = not isinstance(open_period, str) or (
            open_period_key is not None and open_period_key == submission_period_key
        )
        should_consume_open_events = (
            existing_submission is None
            and payload_status != "Resubmitted"
            and open_period_matches_submission
        )
        camera_breakdown = (
            self._camera_breakdown_for_open_events()
            if should_consume_open_events
            else self._report_camera_breakdown(report_id)
        )
        with self._connection() as connection:
            connection.execute(
                """
                insert into report_submissions (
                    report_id,
                    period,
                    submitted_at,
                    entries,
                    exits,
                    peak_occupancy,
                    unique_count,
                    notes,
                    payload_json,
                    sync_status
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                on conflict(report_id) do update set
                    period = excluded.period,
                    submitted_at = excluded.submitted_at,
                    entries = excluded.entries,
                    exits = excluded.exits,
                    peak_occupancy = excluded.peak_occupancy,
                    unique_count = excluded.unique_count,
                    notes = excluded.notes,
                    payload_json = excluded.payload_json,
                    sync_status = excluded.sync_status,
                    synced_at = null
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
                ),
            )
            if should_consume_open_events:
                connection.execute(
                    "delete from report_camera_totals where report_id = ?", (report_id,)
                )
                connection.executemany(
                    """
                    insert into report_camera_totals (
                        report_id,
                        camera_id,
                        camera_name,
                        entries,
                        exits,
                        peak_occupancy,
                        unique_count
                    )
                    values (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            report_id,
                            camera["camera_id"],
                            camera["camera_name"],
                            camera["entries"],
                            camera["exits"],
                            camera["peak_occupancy"],
                            camera["unique_count"],
                        )
                        for camera in camera_breakdown
                    ],
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
            "camera_breakdown": camera_breakdown,
        }

    def _camera_breakdown_for_open_events(self) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute(
                """
                select
                    camera_id,
                    max(camera_name) as camera_name,
                    sum(case when direction = 'entry' then 1 else 0 end) as entries,
                    sum(case when direction = 'exit' then 1 else 0 end) as exits,
                    max(occupancy_count) as peak_occupancy,
                    sum(
                        case
                            when direction = 'entry' and is_unique_entry = 1 then 1
                            else 0
                        end
                    ) as unique_count
                from count_events
                where submitted_report_id is null
                group by camera_id
                order by camera_id
                """
            ).fetchall()
        return [_camera_breakdown_row(row) for row in rows]

    def _report_camera_breakdown(self, report_id: str) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute(
                """
                select camera_id, camera_name, entries, exits, peak_occupancy, unique_count
                from report_camera_totals
                where report_id = ?
                order by camera_id
                """,
                (report_id,),
            ).fetchall()
        return [_camera_breakdown_row(row) for row in rows]

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

    def prepare_sample_counts(
        self,
        *,
        report_id: str,
        entries: int,
        exits: int,
        unique_count: int,
        peak_occupancy: int,
        camera_id: int | None,
        camera_name: str | None,
        period: str,
    ) -> dict[str, int | str | None]:
        with self._connection() as connection:
            existing_report = connection.execute(
                "select count(*) from report_submissions where report_id = ?",
                (report_id,),
            ).fetchone()[0]
            existing_open_period = _period_for_payload_rows(
                connection.execute(
                    """
                    select payload_json
                    from count_events
                    where submitted_report_id is null
                    order by recorded_at asc
                    limit 25
                    """
                ).fetchall()
            )
        if existing_report or existing_open_period is not None:
            return {
                **self.metrics_summary(include_submitted=False),
                "prepared": False,
            }

        rng = random.Random(report_id)
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
            payload = {
                "enterprise_id": self._enterprise_id,
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
                "period": period,
                "counts": {
                    "entry": current_entries,
                    "exit": current_exits,
                    "occupancy": occupancy,
                },
            }
            rows.append(
                (
                    str(uuid4()),
                    recorded_at,
                    self._enterprise_id,
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
                )
            )

        with self._connection() as connection:
            connection.executemany(
                """
                insert into count_events (
                    event_id, recorded_at, enterprise_id, camera_id, camera_name, direction, track_id,
                    entry_count, exit_count, occupancy_count, visitor_id, is_unique_entry,
                    reid_score, reid_decision, identity_confidence, payload_json
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            prepared_at = _utc_now()
            connection.execute(
                """
                insert into enterprise_occupancy_state (
                    singleton_id, current_occupancy, peak_occupancy, updated_at
                ) values (1, 0, ?, ?)
                on conflict(singleton_id) do update set
                    current_occupancy = 0,
                    peak_occupancy = max(peak_occupancy, excluded.peak_occupancy),
                    updated_at = excluded.updated_at
                """,
                (peak_limit, prepared_at),
            )
        return {
            **self.metrics_summary(include_submitted=False),
            "prepared": True,
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
                    synced_at,
                    raw_purged_at
                from report_submissions
                where report_id = ?
                """,
                (report_id,),
            ).fetchone()

        if row is None:
            return None
        return {
            **_report_submission_row(row),
            "camera_breakdown": self._report_camera_breakdown(str(row["report_id"])),
        }

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
                    synced_at,
                    raw_purged_at
                from report_submissions
                where period = ?
                order by submitted_at desc
                limit 1
                """,
                (period,),
            ).fetchone()
        if row is None:
            return None
        return {
            **_report_submission_row(row),
            "camera_breakdown": self._report_camera_breakdown(str(row["report_id"])),
        }

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
                    synced_at,
                    raw_purged_at
                from report_submissions
                order by submitted_at desc
                limit ?
                """,
                (limit,),
            ).fetchall()

        return [
            {
                **_report_submission_row(row),
                "camera_breakdown": self._report_camera_breakdown(str(row["report_id"])),
            }
            for row in rows
        ]

    def get_report_draft(self, draft_key: str) -> dict[str, Any] | None:
        return self._report_drafts.get(draft_key)

    def save_report_draft(
        self,
        draft_key: str,
        period: str,
        payload: dict[str, Any],
        report_id: str | None = None,
    ) -> dict[str, Any]:
        return self._report_drafts.save(draft_key, period, payload, report_id)

    def delete_report_draft(self, draft_key: str) -> bool:
        return self._report_drafts.delete(draft_key)

    def _connection(self) -> AbstractContextManager[sqlite3.Connection]:
        return self._database.connection()

    def _ensure_enterprise_occupancy_state(self, connection: sqlite3.Connection) -> int:
        row = connection.execute(
            "select current_occupancy from enterprise_occupancy_state where singleton_id = 1"
        ).fetchone()
        if row is not None:
            return max(0, _safe_int(row["current_occupancy"]))

        camera_state_row = connection.execute(
            "select coalesce(sum(occupancy_count), 0) as occupancy from camera_monitoring_states"
        ).fetchone()
        event_state_row = connection.execute(
            """
            select
                coalesce(sum(case when direction = 'entry' then 1 else -1 end), 0)
                + coalesce((select sum(delta) from occupancy_corrections), 0) as occupancy
            from count_events
            """
        ).fetchone()
        current_occupancy = max(
            0,
            _safe_int(camera_state_row["occupancy"] if camera_state_row else None),
            _safe_int(event_state_row["occupancy"] if event_state_row else None),
        )
        connection.execute(
            """
            insert or ignore into enterprise_occupancy_state (
                singleton_id, current_occupancy, peak_occupancy, updated_at
            ) values (1, ?, ?, ?)
            """,
            (current_occupancy, current_occupancy, _utc_now()),
        )
        persisted = connection.execute(
            "select current_occupancy from enterprise_occupancy_state where singleton_id = 1"
        ).fetchone()
        return max(0, _safe_int(persisted["current_occupancy"] if persisted else None))
