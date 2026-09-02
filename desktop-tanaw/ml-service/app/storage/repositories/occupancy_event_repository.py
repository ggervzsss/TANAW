import json
import logging
import sqlite3
from typing import Any
from uuid import uuid4

from app.storage.local_data_serialization import _safe_float, _safe_int, _utc_now
from app.storage.local_database import LocalDatabase

logger = logging.getLogger(__name__)


class OccupancyEventRepository:
    """Owns atomic count-event writes and authoritative occupancy corrections."""

    def __init__(self, database: LocalDatabase) -> None:
        self._database = database
        self._enterprise_id = database.enterprise_id

    def append(self, payload: dict[str, Any], recorded_at: str | None = None) -> str:
        supplied_event_id = payload.get("event_id")
        event_id = supplied_event_id.strip() if isinstance(supplied_event_id, str) else str(uuid4())
        recorded_at = recorded_at or _utc_now()
        raw_counts = payload.get("counts")
        counts: dict[str, Any] = raw_counts if isinstance(raw_counts, dict) else {}
        direction = payload.get("direction")
        is_unique_entry = payload.get("is_unique_entry")
        if is_unique_entry is None:
            is_unique_entry = direction == "entry"

        with self._database.connection() as connection:
            # This transaction serializes enterprise-wide occupancy updates across cameras.
            connection.execute("begin immediate")
            current_occupancy = self._ensure_state(connection)
            cursor = connection.execute(
                """
                insert or ignore into count_events (
                    event_id, recorded_at, enterprise_id, camera_id, camera_name,
                    direction, track_id, entry_count, exit_count, occupancy_count,
                    visitor_id, is_unique_entry, reid_score, reid_decision,
                    identity_confidence, enterprise_occupancy_count, payload_json
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
                    set current_occupancy = ?, peak_occupancy = max(peak_occupancy, ?),
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

    def record_correction(
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
        del old_occupancy  # The authoritative old value is read inside the write transaction.
        correction_id = str(uuid4())
        recorded_at = recorded_at or _utc_now()
        with self._database.connection() as connection:
            connection.execute("begin immediate")
            authoritative_old_occupancy = self._ensure_state(connection)
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
                    correction_id, enterprise_id, camera_id, old_occupancy,
                    new_occupancy, delta, reason, actor_id, actor_name,
                    recorded_at, payload_json
                ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                set current_occupancy = ?, peak_occupancy = max(peak_occupancy, ?),
                    updated_at = ?
                where singleton_id = 1
                """,
                (normalized_new_occupancy, normalized_new_occupancy, recorded_at),
            )
        return payload

    def current_occupancy(self) -> int:
        with self._database.connection() as connection:
            return self._ensure_state(connection)

    def list_corrections(self, limit: int = 100) -> list[dict[str, Any]]:
        limit = max(1, min(limit, 500))
        with self._database.connection() as connection:
            rows = connection.execute(
                """
                select correction_id, enterprise_id, camera_id, old_occupancy,
                       new_occupancy, delta, reason, actor_id, actor_name, recorded_at
                from occupancy_corrections
                order by recorded_at desc
                limit ?
                """,
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    @staticmethod
    def _ensure_state(connection: sqlite3.Connection) -> int:
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
            select coalesce(sum(case when direction = 'entry' then 1 else -1 end), 0)
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
