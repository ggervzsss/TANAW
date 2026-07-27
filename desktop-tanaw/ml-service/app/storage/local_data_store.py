import json
import logging
import os
import random
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from ipaddress import IPv4Address
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

from app.config.camera_config import reporting_period_key

LOCAL_SCHEMA_VERSION = 6
MIGRATABLE_SCHEMA_VERSIONS = {5}

logger = logging.getLogger(__name__)


class LocalDatabaseResetRequiredError(RuntimeError):
    """Raised when a pre-canonical local database must be explicitly recreated."""


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


class LocalDataStore:
    def __init__(self, app_data_dir: str | None = None, enterprise_id: str | None = None) -> None:
        self._enterprise_id = enterprise_id
        base_dir = app_data_dir or os.environ.get("TANAW_APP_DATA_DIR")
        if base_dir:
            root = Path(base_dir) / "ml-service"
        else:
            root = Path.home() / ".tanaw" / "ml-service"

        self._root = root / "enterprises" / _safe_scope(enterprise_id) if enterprise_id else root

        self._database_path = self._root / "tanaw_desktop.sqlite3"
        self._retired_database_path = self._root / "tanaw_metrics.sqlite3"
        self._initialized = False

    def load_monitoring_state(self, camera_id: int | None = None) -> dict[str, Any] | None:
        with self._connection() as connection:
            where_clause = "where camera_id = ?" if camera_id is not None else ""
            parameters: tuple[Any, ...] = (camera_id,) if camera_id is not None else ()
            row = connection.execute(
                f"""
                select
                    camera_id,
                    camera_name_snapshot,
                    running,
                    status,
                    error,
                    started_at,
                    entry_count,
                    exit_count,
                    occupancy_count,
                    camera_config_json,
                    updated_at
                from camera_monitoring_states
                {where_clause}
                order by updated_at desc
                limit 1
                """,
                parameters,
            ).fetchone()
        if row is None:
            return None

        camera_config = _load_json_object(row["camera_config_json"])
        return {
            "running": bool(row["running"]),
            "status": row["status"],
            "error": row["error"],
            "camera_id": row["camera_id"],
            "camera_name": row["camera_name_snapshot"],
            "camera_config": camera_config,
            "counts": {
                "entry": _safe_int(row["entry_count"]),
                "exit": _safe_int(row["exit_count"]),
                "occupancy": _safe_int(row["occupancy_count"]),
                "running": bool(row["running"]),
                "status": row["status"],
                "started_at": row["started_at"],
                "error": row["error"],
            },
            "updated_at": row["updated_at"],
        }

    def list_monitoring_states(self) -> list[dict[str, Any]]:
        with self._connection() as connection:
            camera_ids = [
                int(row["camera_id"])
                for row in connection.execute(
                    "select camera_id from camera_monitoring_states order by camera_id"
                ).fetchall()
            ]
        return [
            state for camera_id in camera_ids if (state := self.load_monitoring_state(camera_id))
        ]

    def save_monitoring_state(
        self, payload: dict[str, Any], updated_at: str | None = None
    ) -> dict[str, Any]:
        updated_at = updated_at or _utc_now()
        raw_counts = payload.get("counts")
        counts: dict[str, Any] = raw_counts if isinstance(raw_counts, dict) else {}
        camera_config = payload.get("camera_config")
        config_payload = camera_config if isinstance(camera_config, dict) else {}
        camera_id = payload.get("camera_id")
        if isinstance(camera_id, bool) or not isinstance(camera_id, int) or camera_id <= 0:
            raise ValueError("Camera ID is required when saving camera monitoring state.")
        with self._connection() as connection:
            connection.execute(
                """
                insert into camera_monitoring_states (
                    camera_id,
                    camera_name_snapshot,
                    running,
                    status,
                    error,
                    started_at,
                    entry_count,
                    exit_count,
                    occupancy_count,
                    camera_config_json,
                    updated_at
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                on conflict(camera_id) do update set
                    camera_name_snapshot = excluded.camera_name_snapshot,
                    running = excluded.running,
                    status = excluded.status,
                    error = excluded.error,
                    started_at = excluded.started_at,
                    entry_count = excluded.entry_count,
                    exit_count = excluded.exit_count,
                    occupancy_count = excluded.occupancy_count,
                    camera_config_json = excluded.camera_config_json,
                    updated_at = excluded.updated_at
                """,
                (
                    camera_id,
                    payload.get("camera_name"),
                    int(bool(payload.get("running"))),
                    str(payload.get("status") or "stopped"),
                    payload.get("error"),
                    counts.get("started_at"),
                    _safe_int(counts.get("entry")),
                    _safe_int(counts.get("exit")),
                    _safe_int(counts.get("occupancy")),
                    json.dumps(config_payload, sort_keys=True),
                    updated_at,
                ),
            )
        return {**payload, "updated_at": updated_at}

    def list_camera_profiles(self) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute(
                """
                select payload_json
                from camera_profiles
                order by created_at asc, camera_id asc
                """
            ).fetchall()
        return [_load_json_object(row["payload_json"]) for row in rows]

    def replace_camera_profiles(self, cameras: list[dict[str, Any]]) -> list[dict[str, Any]]:
        normalized = [_normalized_camera_profile(camera) for camera in cameras]
        camera_ids = [int(camera["id"]) for camera in normalized]
        if len(camera_ids) != len(set(camera_ids)):
            raise ValueError("Camera IDs must be unique.")

        updated_at = _utc_now()
        with self._connection() as connection:
            if camera_ids:
                placeholders = ", ".join("?" for _ in camera_ids)
                connection.execute(
                    f"delete from camera_profiles where camera_id not in ({placeholders})",
                    camera_ids,
                )
            else:
                connection.execute("delete from camera_profiles")

            for camera in normalized:
                connection.execute(
                    """
                    insert into camera_profiles (
                        camera_id,
                        name,
                        zone,
                        status,
                        camera_host,
                        rtsp_stream,
                        stream_url,
                        processing_profile,
                        tracking_confidence,
                        counting_confidence,
                        reid_mode,
                        unique_counting_mode,
                        config_json,
                        payload_json,
                        created_at,
                        updated_at
                    )
                    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    on conflict(camera_id) do update set
                        name = excluded.name,
                        zone = excluded.zone,
                        status = excluded.status,
                        camera_host = excluded.camera_host,
                        rtsp_stream = excluded.rtsp_stream,
                        stream_url = excluded.stream_url,
                        processing_profile = excluded.processing_profile,
                        tracking_confidence = excluded.tracking_confidence,
                        counting_confidence = excluded.counting_confidence,
                        reid_mode = excluded.reid_mode,
                        unique_counting_mode = excluded.unique_counting_mode,
                        config_json = excluded.config_json,
                        payload_json = excluded.payload_json,
                        updated_at = excluded.updated_at
                    """,
                    (
                        camera["id"],
                        camera["name"],
                        camera["zone"],
                        camera["status"],
                        camera.get("cameraHost"),
                        camera.get("rtspStream"),
                        camera["rtsp"],
                        camera["processingProfile"],
                        camera.get("trackingConfidence"),
                        camera["confidence"],
                        camera.get("reidMode"),
                        camera.get("uniqueCountingMode"),
                        json.dumps(camera["config"], sort_keys=True),
                        json.dumps(camera, sort_keys=True),
                        updated_at,
                        updated_at,
                    ),
                )
        return normalized

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
                    expires_at,
                    identity_status,
                    canonical_visitor_id
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                on conflict(visitor_id) do update set
                    last_seen_at = excluded.last_seen_at,
                    representative_embedding = excluded.representative_embedding,
                    embedding_dim = excluded.embedding_dim,
                    embedding_count = excluded.embedding_count,
                    model_name = excluded.model_name,
                    expires_at = excluded.expires_at,
                    identity_status = excluded.identity_status,
                    canonical_visitor_id = excluded.canonical_visitor_id
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
                    identity_status,
                    canonical_visitor_id,
                ),
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
        recorded_at = recorded_at or _utc_now()
        with self._connection() as connection:
            connection.execute(
                """
                insert into visitor_identity_prototypes (
                    visitor_id,
                    model_name,
                    prototype_index,
                    representative_embedding,
                    embedding_dim,
                    embedding_count,
                    updated_at
                )
                values (?, ?, ?, ?, ?, ?, ?)
                on conflict(visitor_id, model_name, prototype_index) do update set
                    representative_embedding = excluded.representative_embedding,
                    embedding_dim = excluded.embedding_dim,
                    embedding_count = excluded.embedding_count,
                    updated_at = excluded.updated_at
                """,
                (
                    visitor_id,
                    model_name,
                    prototype_index,
                    embedding,
                    embedding_dim,
                    embedding_count,
                    recorded_at,
                ),
            )

    def resolve_visitor_identity(
        self,
        visitor_id: str,
        *,
        identity_status: str,
        canonical_visitor_id: str | None = None,
        recorded_at: str | None = None,
    ) -> None:
        if identity_status not in {"confirmed", "provisional", "merged"}:
            raise ValueError(f"Unsupported visitor identity status: {identity_status}")
        if identity_status == "merged" and not canonical_visitor_id:
            raise ValueError("Merged visitor identities require a canonical visitor ID.")

        with self._connection() as connection:
            connection.execute(
                """
                update visitor_identities
                set identity_status = ?,
                    canonical_visitor_id = ?,
                    last_seen_at = ?
                where visitor_id = ?
                """,
                (
                    identity_status,
                    canonical_visitor_id,
                    recorded_at or _utc_now(),
                    visitor_id,
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
                    expires_at,
                    identity_status,
                    canonical_visitor_id
                from visitor_identities
                where business_date = ?
                    and expires_at > ?
                    and identity_status != 'merged'
                order by last_seen_at desc
                """,
                (business_date, now),
            ).fetchall()

        return [dict(row) for row in rows]

    def load_active_visitor_identity_prototypes(
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
                    prototypes.visitor_id,
                    identities.business_date,
                    identities.camera_id,
                    prototypes.model_name,
                    prototypes.prototype_index,
                    prototypes.representative_embedding,
                    prototypes.embedding_dim,
                    prototypes.embedding_count,
                    identities.expires_at
                from visitor_identity_prototypes as prototypes
                join visitor_identities as identities
                    on identities.visitor_id = prototypes.visitor_id
                where identities.business_date = ?
                    and identities.expires_at > ?
                    and identities.identity_status != 'merged'
                    and prototypes.model_name = ?
                order by prototypes.visitor_id, prototypes.prototype_index
                """,
                (business_date, now, model_name),
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
                    and identities.identity_status != 'merged'
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
                    enterprise_id,
                    camera_id,
                    camera_name,
                    entry_count,
                    exit_count,
                    occupancy_count,
                    running,
                    status,
                    error,
                    payload_json
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    recorded_at,
                    payload.get("enterprise_id", self._enterprise_id),
                    payload.get("camera_id"),
                    payload.get("camera_name"),
                    _safe_int(counts.get("entry")),
                    _safe_int(counts.get("exit")),
                    _safe_int(counts.get("occupancy")),
                    1 if payload.get("running") else 0,
                    payload.get("status"),
                    payload.get("error"),
                    json.dumps(payload, sort_keys=True),
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
        with self._connection() as connection:
            row = connection.execute(
                """
                select draft_key, period, report_id, payload_json, updated_at
                from report_drafts
                where draft_key = ?
                """,
                (draft_key,),
            ).fetchone()
        return _report_draft_row(row) if row is not None else None

    def save_report_draft(
        self,
        draft_key: str,
        period: str,
        payload: dict[str, Any],
        report_id: str | None = None,
    ) -> dict[str, Any]:
        updated_at = _utc_now()
        with self._connection() as connection:
            connection.execute(
                """
                insert into report_drafts (
                    draft_key,
                    period,
                    report_id,
                    payload_json,
                    updated_at
                )
                values (?, ?, ?, ?, ?)
                on conflict(draft_key) do update set
                    period = excluded.period,
                    report_id = excluded.report_id,
                    payload_json = excluded.payload_json,
                    updated_at = excluded.updated_at
                """,
                (
                    draft_key,
                    period,
                    report_id,
                    json.dumps(payload, sort_keys=True),
                    updated_at,
                ),
            )
        return {
            "draft_key": draft_key,
            "period": period,
            "report_id": report_id,
            "payload": payload,
            "updated_at": updated_at,
        }

    def delete_report_draft(self, draft_key: str) -> bool:
        with self._connection() as connection:
            cursor = connection.execute(
                "delete from report_drafts where draft_key = ?",
                (draft_key,),
            )
        return cursor.rowcount > 0

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        self._initialize()
        connection = sqlite3.connect(self._database_path)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("pragma foreign_keys = on")
            connection.execute("pragma busy_timeout = 5000")
            yield connection
            connection.commit()
        finally:
            connection.close()

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

    def _initialize(self) -> None:
        if self._initialized:
            return

        self._root.mkdir(parents=True, exist_ok=True)
        if not self._database_path.exists() and self._retired_database_path.exists():
            reset_command = (
                f'npm run local-data -- clear --enterprise "{self._enterprise_id}" --yes'
                if self._enterprise_id
                else "npm run local-data -- clear --full-device --yes"
            )
            raise LocalDatabaseResetRequiredError(
                "The retired tanaw_metrics.sqlite3 database is still present. TANAW will not "
                f"silently replace local data. Close TANAW and run `{reset_command}`, then "
                "reopen the application."
            )
        database_exists = self._database_path.exists()
        connection = sqlite3.connect(self._database_path)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("pragma foreign_keys = on")
            connection.execute("pragma journal_mode = wal")
            connection.execute("pragma synchronous = normal")
            connection.execute("pragma busy_timeout = 5000")
            existing_tables = {
                str(row["name"])
                for row in connection.execute("select name from sqlite_master where type = 'table'")
            }
            if database_exists and existing_tables and "schema_metadata" not in existing_tables:
                raise LocalDatabaseResetRequiredError(
                    "The local TANAW database uses the retired pre-versioned schema. "
                    "Close TANAW and run `npm run local-data -- clear --enterprise "
                    "<enterprise-id> --yes`, then reopen the application."
                )
            current_version = 0
            if "schema_metadata" in existing_tables:
                version_row = connection.execute(
                    "select schema_version from schema_metadata where singleton_id = 1"
                ).fetchone()
                current_version = _safe_int(
                    version_row["schema_version"] if version_row is not None else None
                )
                if current_version in MIGRATABLE_SCHEMA_VERSIONS:
                    self._migrate_schema(connection, current_version)
                    current_version = LOCAL_SCHEMA_VERSION
                if current_version != LOCAL_SCHEMA_VERSION:
                    raise LocalDatabaseResetRequiredError(
                        f"Local TANAW database schema {current_version} is incompatible with "
                        f"the required schema {LOCAL_SCHEMA_VERSION}. Explicitly clear this "
                        "enterprise's local data before reopening TANAW."
                    )

            connection.executescript(
                f"""
                create table if not exists schema_metadata (
                    singleton_id integer primary key check (singleton_id = 1),
                    schema_version integer not null,
                    applied_at text not null
                );

                create table if not exists camera_profiles (
                    camera_id integer primary key,
                    name text not null,
                    zone text not null,
                    status text not null check (
                        status in ('untested', 'online', 'offline', 'running', 'stopped', 'error')
                    ),
                    camera_host text not null,
                    rtsp_stream text not null check (rtsp_stream in ('stream1', 'stream2')),
                    stream_url text not null,
                    processing_profile text not null check (
                        processing_profile in (
                            'auto', 'compatibility', 'balanced', 'high_accuracy', 'emergency'
                        )
                    ),
                    tracking_confidence real,
                    counting_confidence real not null,
                    reid_mode text check (reid_mode in ('auto', 'off', 'fast', 'quality')),
                    unique_counting_mode text check (
                        unique_counting_mode in ('entry_only', 'estimated_reid')
                    ),
                    config_json text not null,
                    payload_json text not null,
                    created_at text not null,
                    updated_at text not null
                );

                create table if not exists active_monitoring_state (
                    singleton_id integer primary key check (singleton_id = 1),
                    camera_id integer,
                    camera_name_snapshot text,
                    running integer not null default 0 check (running in (0, 1)),
                    status text not null,
                    error text,
                    started_at text,
                    entry_count integer not null default 0,
                    exit_count integer not null default 0,
                    occupancy_count integer not null default 0,
                    camera_config_json text not null,
                    updated_at text not null
                );

                create table if not exists camera_monitoring_states (
                    camera_id integer primary key,
                    camera_name_snapshot text,
                    running integer not null default 0 check (running in (0, 1)),
                    status text not null,
                    error text,
                    started_at text,
                    entry_count integer not null default 0,
                    exit_count integer not null default 0,
                    occupancy_count integer not null default 0,
                    camera_config_json text not null,
                    updated_at text not null
                );

                create table if not exists enterprise_occupancy_state (
                    singleton_id integer primary key check (singleton_id = 1),
                    current_occupancy integer not null default 0 check (current_occupancy >= 0),
                    peak_occupancy integer not null default 0 check (peak_occupancy >= 0),
                    updated_at text not null
                );

                insert or ignore into schema_metadata (
                    singleton_id, schema_version, applied_at
                ) values (
                    1, {LOCAL_SCHEMA_VERSION}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                );

                create table if not exists count_events (
                    id integer primary key autoincrement,
                    event_id text not null unique,
                    recorded_at text not null,
                    enterprise_id text,
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
                    enterprise_occupancy_count integer,
                    payload_json text not null,
                    submitted_report_id text,
                    synced_at text,
                    constraint fk_count_events_report_submission
                        foreign key (submitted_report_id)
                        references report_submissions(report_id)
                        on update cascade on delete set null
                );

                create index if not exists idx_count_events_recorded_at on count_events(recorded_at);
                create index if not exists idx_count_events_camera_recorded_at
                    on count_events(camera_id, recorded_at);
                create index if not exists idx_count_events_submitted_report_id on count_events(submitted_report_id);
                create index if not exists idx_count_events_synced_at on count_events(synced_at);

                create table if not exists count_snapshots (
                    id integer primary key autoincrement,
                    recorded_at text not null,
                    enterprise_id text,
                    camera_id integer,
                    camera_name text,
                    entry_count integer not null default 0,
                    exit_count integer not null default 0,
                    occupancy_count integer not null default 0,
                    running integer not null default 0,
                    status text,
                    error text,
                    payload_json text not null
                );

                create index if not exists idx_count_snapshots_recorded_at on count_snapshots(recorded_at);
                create index if not exists idx_count_snapshots_camera_recorded_at
                    on count_snapshots(camera_id, recorded_at);

                create table if not exists report_submissions (
                    report_id text primary key,
                    period text not null unique,
                    submitted_at text not null,
                    entries integer not null default 0,
                    exits integer not null default 0,
                    peak_occupancy integer not null default 0,
                    unique_count integer not null default 0,
                    notes text,
                    payload_json text not null,
                    sync_status text not null default 'pending_cloud_sync',
                    synced_at text,
                    raw_purged_at text
                );

                create table if not exists report_drafts (
                    draft_key text primary key,
                    period text not null,
                    report_id text,
                    payload_json text not null,
                    updated_at text not null
                );

                create table if not exists report_camera_totals (
                    report_id text not null,
                    camera_id integer,
                    camera_name text,
                    entries integer not null default 0,
                    exits integer not null default 0,
                    peak_occupancy integer not null default 0,
                    unique_count integer not null default 0,
                    primary key (report_id, camera_id),
                    constraint fk_report_camera_totals_submission
                        foreign key (report_id)
                        references report_submissions(report_id)
                        on update cascade on delete cascade
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
                    recorded_at text not null,
                    payload_json text not null
                );

                create index if not exists idx_occupancy_corrections_recorded_at
                    on occupancy_corrections(recorded_at);
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
                    expires_at text not null,
                    identity_status text not null default 'confirmed' check (
                        identity_status in ('confirmed', 'provisional', 'merged')
                    ),
                    canonical_visitor_id text
                );

                create index if not exists idx_visitor_identities_business_date on visitor_identities(business_date);
                create index if not exists idx_visitor_identities_expires_at on visitor_identities(expires_at);
                create index if not exists idx_visitor_identities_status on visitor_identities(identity_status);

                create table if not exists visitor_identity_prototypes (
                    visitor_id text not null,
                    model_name text not null,
                    prototype_index integer not null check (prototype_index >= 0),
                    representative_embedding blob not null,
                    embedding_dim integer not null,
                    embedding_count integer not null default 1,
                    updated_at text not null,
                    primary key (visitor_id, model_name, prototype_index),
                    constraint fk_visitor_identity_prototypes_identity
                        foreign key (visitor_id)
                        references visitor_identities(visitor_id)
                        on update cascade on delete cascade
                );

                create index if not exists idx_visitor_identity_prototypes_model
                    on visitor_identity_prototypes(model_name);

                create table if not exists visitor_model_embeddings (
                    visitor_id text not null,
                    model_name text not null,
                    representative_embedding blob not null,
                    embedding_dim integer not null,
                    embedding_count integer not null default 1,
                    updated_at text not null,
                    primary key (visitor_id, model_name),
                    constraint fk_visitor_model_embeddings_identity
                        foreign key (visitor_id)
                        references visitor_identities(visitor_id)
                        on update cascade on delete cascade
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
                    constraint fk_visitor_sightings_identity
                        foreign key (visitor_id)
                        references visitor_identities(visitor_id)
                        on update cascade on delete cascade
                );

                create index if not exists idx_visitor_sightings_business_date on visitor_sightings(business_date);
                """
            )
            connection.commit()
        finally:
            connection.close()

        self._initialized = True

    def _migrate_schema(self, connection: sqlite3.Connection, current_version: int) -> None:
        if current_version != 5:
            return

        identity_columns = {
            str(row["name"])
            for row in connection.execute("pragma table_info(visitor_identities)").fetchall()
        }
        if "identity_status" not in identity_columns:
            connection.execute(
                """
                alter table visitor_identities
                    add column identity_status text not null default 'confirmed'
                    check (identity_status in ('confirmed', 'provisional', 'merged'))
                """
            )
        if "canonical_visitor_id" not in identity_columns:
            connection.execute(
                "alter table visitor_identities add column canonical_visitor_id text"
            )

        existing_tables = {
            str(row["name"])
            for row in connection.execute("select name from sqlite_master where type = 'table'")
        }
        if "visitor_sightings" in existing_tables:
            connection.execute(
                """
                update visitor_identities
                set identity_status = 'provisional'
                where exists (
                    select 1
                    from visitor_sightings
                    where visitor_sightings.visitor_id = visitor_identities.visitor_id
                        and visitor_sightings.reid_decision = 'ambiguous_new'
                )
                    and not exists (
                        select 1
                        from visitor_sightings
                        where visitor_sightings.visitor_id = visitor_identities.visitor_id
                            and visitor_sightings.reid_decision = 'provisional_confirmed'
                    )
                """
            )
        if "count_events" in existing_tables:
            ambiguous_events = connection.execute(
                """
                select id, payload_json
                from count_events
                where submitted_report_id is null
                    and direction = 'entry'
                    and reid_decision = 'ambiguous_new'
                    and coalesce(identity_confidence, 'low') = 'low'
                """
            ).fetchall()
            for event in ambiguous_events:
                payload = _load_json_object(event["payload_json"])
                payload["is_unique_entry"] = False
                connection.execute(
                    """
                    update count_events
                    set is_unique_entry = 0,
                        payload_json = ?,
                        synced_at = null
                    where id = ?
                    """,
                    (json.dumps(payload, sort_keys=True), event["id"]),
                )

        connection.executescript(
            """
            create index if not exists idx_visitor_identities_status
                on visitor_identities(identity_status);

            create table if not exists visitor_identity_prototypes (
                visitor_id text not null,
                model_name text not null,
                prototype_index integer not null check (prototype_index >= 0),
                representative_embedding blob not null,
                embedding_dim integer not null,
                embedding_count integer not null default 1,
                updated_at text not null,
                primary key (visitor_id, model_name, prototype_index),
                constraint fk_visitor_identity_prototypes_identity
                    foreign key (visitor_id)
                    references visitor_identities(visitor_id)
                    on update cascade on delete cascade
            );

            create index if not exists idx_visitor_identity_prototypes_model
                on visitor_identity_prototypes(model_name);

            insert or ignore into visitor_identity_prototypes (
                visitor_id,
                model_name,
                prototype_index,
                representative_embedding,
                embedding_dim,
                embedding_count,
                updated_at
            )
            select
                visitor_id,
                model_name,
                0,
                representative_embedding,
                embedding_dim,
                embedding_count,
                last_seen_at
            from visitor_identities;

            update schema_metadata
            set schema_version = 6,
                applied_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            where singleton_id = 1;
            """
        )
        connection.commit()


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


def _load_json_object(value: Any) -> dict[str, Any]:
    if not isinstance(value, str):
        return {}
    try:
        payload = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _normalized_camera_profile(camera: dict[str, Any]) -> dict[str, Any]:
    required_string_fields = (
        "name",
        "status",
        "zone",
        "rtsp",
        "processingProfile",
    )
    if isinstance(camera.get("id"), bool) or not isinstance(camera.get("id"), int):
        raise ValueError("Camera ID must be an integer.")
    if int(camera["id"]) <= 0:
        raise ValueError("Camera ID must be positive.")
    for field in required_string_fields:
        if not isinstance(camera.get(field), str) or not str(camera[field]).strip():
            raise ValueError(f"Camera {field} is required.")
    raw_status = str(camera["status"])
    status = (
        "running"
        if raw_status in {"starting", "connecting", "degraded", "reconnecting"}
        else "error"
        if raw_status == "failed"
        else raw_status
    )
    if status not in {"untested", "online", "offline", "running", "stopped", "error"}:
        raise ValueError("Camera status is invalid.")
    if camera.get("username") is not None or camera.get("password") is not None:
        raise ValueError("Camera credentials must not be stored in SQLite.")
    if not isinstance(camera.get("config"), dict):
        raise ValueError("Camera configuration is required.")
    stream_url = str(camera["rtsp"]).strip()
    parsed_stream_url = urlparse(stream_url)
    if parsed_stream_url.username is not None or parsed_stream_url.password is not None:
        raise ValueError("Camera stream credentials must not be stored in SQLite.")

    raw_host = camera.get("cameraHost") or parsed_stream_url.hostname or ""
    try:
        camera_host = str(IPv4Address(str(raw_host).strip()))
    except ValueError as exc:
        raise ValueError("Camera IP / Host must be a valid IPv4 address.") from exc
    path_profile = parsed_stream_url.path.strip("/").split("/", maxsplit=1)[0]
    raw_profile = camera.get("rtspStream") or path_profile or "stream2"
    if raw_profile not in {"stream1", "stream2"}:
        raise ValueError("RTSP Stream must be stream1 or stream2.")
    rtsp_stream = str(raw_profile)
    canonical_url = f"rtsp://{camera_host}/{rtsp_stream}"
    if stream_url != canonical_url:
        raise ValueError("Stream URL conflicts with Camera IP / Host and the selected RTSP Stream.")

    return {
        **camera,
        "id": int(camera["id"]),
        "status": status,
        "cameraHost": camera_host,
        "rtspStream": rtsp_stream,
        "rtsp": stream_url,
        "confidence": float(camera.get("confidence") or 0.35),
        "trackingConfidence": (
            float(camera["trackingConfidence"])
            if camera.get("trackingConfidence") is not None
            else None
        ),
    }


def _camera_breakdown_row(row: sqlite3.Row) -> dict[str, Any]:
    entries = _safe_int(row["entries"])
    exits = _safe_int(row["exits"])
    return {
        "camera_id": int(row["camera_id"]) if row["camera_id"] is not None else None,
        "camera_name": row["camera_name"],
        "entries": entries,
        "exits": exits,
        "peak_occupancy": _safe_int(row["peak_occupancy"]),
        "unique_count": _safe_int(row["unique_count"]),
        "total_events": entries + exits,
    }


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


def _period_for_payload_rows(rows: list[sqlite3.Row]) -> str | None:
    for row in rows:
        try:
            payload = json.loads(str(row["payload_json"]))
        except (json.JSONDecodeError, TypeError):
            continue
        period = payload.get("period") if isinstance(payload, dict) else None
        if isinstance(period, str) and period.strip():
            return period
    return None


def _submitted_filter_sql(include_submitted: bool) -> str:
    return "" if include_submitted else "where submitted_report_id is null"


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
        "submitted_at": row["submitted_at"],
        "entries": _safe_int(row["entries"]),
        "exits": _safe_int(row["exits"]),
        "peak_occupancy": _safe_int(row["peak_occupancy"]),
        "unique_count": _safe_int(row["unique_count"]),
        "notes": row["notes"],
        "payload": payload if isinstance(payload, dict) else {},
        "sync_status": row["sync_status"],
        "synced_at": row["synced_at"],
        "raw_purged_at": row["raw_purged_at"],
    }


def _report_draft_row(row: sqlite3.Row) -> dict[str, Any]:
    try:
        payload = json.loads(row["payload_json"]) if row["payload_json"] else {}
    except json.JSONDecodeError:
        payload = {}

    return {
        "draft_key": row["draft_key"],
        "period": row["period"],
        "report_id": row["report_id"],
        "payload": payload if isinstance(payload, dict) else {},
        "updated_at": row["updated_at"],
    }
