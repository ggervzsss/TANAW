import json
from typing import Any

from app.storage.local_data_serialization import (
    _load_json_object,
    _normalized_camera_profile,
    _safe_int,
    _utc_now,
)
from app.storage.local_database import LocalDatabase


class CameraRepository:
    def __init__(self, database: LocalDatabase) -> None:
        self._database = database

    def load_monitoring_state(self, camera_id: int | None = None) -> dict[str, Any] | None:
        with self._database.connection() as connection:
            where_clause = "where camera_id = ?" if camera_id is not None else ""
            parameters: tuple[Any, ...] = (camera_id,) if camera_id is not None else ()
            row = connection.execute(
                f"""select camera_id, camera_name_snapshot, running, status, error,
                           started_at, entry_count, exit_count, occupancy_count,
                           camera_config_json, updated_at
                    from camera_monitoring_states {where_clause}
                    order by updated_at desc limit 1""",
                parameters,
            ).fetchone()
        if row is None:
            return None
        counts = {
            "entry": _safe_int(row["entry_count"]),
            "exit": _safe_int(row["exit_count"]),
            "occupancy": _safe_int(row["occupancy_count"]),
            "running": bool(row["running"]),
            "status": row["status"],
            "started_at": row["started_at"],
            "error": row["error"],
        }
        return {
            "running": bool(row["running"]),
            "status": row["status"],
            "error": row["error"],
            "camera_id": row["camera_id"],
            "camera_name": row["camera_name_snapshot"],
            "camera_config": _load_json_object(row["camera_config_json"]),
            "counts": counts,
            "updated_at": row["updated_at"],
        }

    def list_monitoring_states(self) -> list[dict[str, Any]]:
        with self._database.connection() as connection:
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
        with self._database.connection() as connection:
            connection.execute(
                """insert into camera_monitoring_states (
                       camera_id, camera_name_snapshot, running, status, error, started_at,
                       entry_count, exit_count, occupancy_count, camera_config_json, updated_at
                   ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   on conflict(camera_id) do update set
                       camera_name_snapshot = excluded.camera_name_snapshot,
                       running = excluded.running, status = excluded.status,
                       error = excluded.error, started_at = excluded.started_at,
                       entry_count = excluded.entry_count, exit_count = excluded.exit_count,
                       occupancy_count = excluded.occupancy_count,
                       camera_config_json = excluded.camera_config_json,
                       updated_at = excluded.updated_at""",
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

    def list_profiles(self) -> list[dict[str, Any]]:
        with self._database.connection() as connection:
            rows = connection.execute(
                "select payload_json from camera_profiles order by created_at asc, camera_id asc"
            ).fetchall()
        return [_load_json_object(row["payload_json"]) for row in rows]

    def replace_profiles(self, cameras: list[dict[str, Any]]) -> list[dict[str, Any]]:
        normalized = [_normalized_camera_profile(camera) for camera in cameras]
        camera_ids = [int(camera["id"]) for camera in normalized]
        if len(camera_ids) != len(set(camera_ids)):
            raise ValueError("Camera IDs must be unique.")
        updated_at = _utc_now()
        with self._database.connection() as connection:
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
                    """insert into camera_profiles (
                           camera_id, name, zone, status, camera_host, rtsp_stream, stream_url,
                           processing_profile, tracking_confidence, counting_confidence,
                           reid_mode, unique_counting_mode, config_json, payload_json,
                           created_at, updated_at
                       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                       on conflict(camera_id) do update set
                           name = excluded.name, zone = excluded.zone, status = excluded.status,
                           camera_host = excluded.camera_host, rtsp_stream = excluded.rtsp_stream,
                           stream_url = excluded.stream_url,
                           processing_profile = excluded.processing_profile,
                           tracking_confidence = excluded.tracking_confidence,
                           counting_confidence = excluded.counting_confidence,
                           reid_mode = excluded.reid_mode,
                           unique_counting_mode = excluded.unique_counting_mode,
                           config_json = excluded.config_json,
                           payload_json = excluded.payload_json, updated_at = excluded.updated_at""",
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
