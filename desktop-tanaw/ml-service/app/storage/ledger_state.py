from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from typing import Any

from app.camera.auth import redact_stream_credentials

MAX_EVENT_ATTRIBUTES_BYTES = 65_536


def bind_local_site(
    connection: sqlite3.Connection,
    *,
    enterprise_id: str | None,
    display_name: str | None = None,
) -> None:
    now = datetime.now(UTC).isoformat()
    connection.execute(
        """
        insert into local_sites (
            local_site_id,
            enterprise_id,
            display_name,
            created_at,
            updated_at
        )
        values ('primary', ?, ?, ?, ?)
        on conflict(local_site_id) do update set
            enterprise_id = coalesce(excluded.enterprise_id, local_sites.enterprise_id),
            display_name = coalesce(excluded.display_name, local_sites.display_name),
            updated_at = excluded.updated_at
        """,
        (enterprise_id, display_name, now, now),
    )


def upsert_local_camera(
    connection: sqlite3.Connection,
    *,
    camera_key: str,
    central_camera_id: str | None,
    local_camera_id: Any,
    display_name: str | None,
    observed_at: str,
) -> None:
    connection.execute(
        """
        insert into local_cameras (
            camera_key,
            local_site_id,
            central_camera_id,
            local_camera_id,
            display_name,
            first_seen_at,
            last_seen_at
        )
        values (?, 'primary', ?, ?, ?, ?, ?)
        on conflict(camera_key) do update set
            central_camera_id = coalesce(
                excluded.central_camera_id,
                local_cameras.central_camera_id
            ),
            local_camera_id = coalesce(excluded.local_camera_id, local_cameras.local_camera_id),
            display_name = coalesce(excluded.display_name, local_cameras.display_name),
            first_seen_at = min(local_cameras.first_seen_at, excluded.first_seen_at),
            last_seen_at = max(local_cameras.last_seen_at, excluded.last_seen_at)
        """,
        (
            camera_key,
            central_camera_id,
            local_camera_id,
            display_name,
            observed_at,
            observed_at,
        ),
    )


def upsert_camera_live_state(
    connection: sqlite3.Connection,
    *,
    camera_key: str,
    observed_at: str,
    status: Any,
    running: bool,
    entry_count: int,
    exit_count: int,
    occupancy_count: int,
    error: Any,
) -> None:
    connection.execute(
        """
        insert into camera_live_state (
            camera_key,
            observed_at,
            state,
            running,
            entry_count,
            exit_count,
            occupancy_count,
            error_summary
        )
        values (?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(camera_key) do update set
            observed_at = excluded.observed_at,
            state = excluded.state,
            running = excluded.running,
            entry_count = excluded.entry_count,
            exit_count = excluded.exit_count,
            occupancy_count = excluded.occupancy_count,
            error_summary = excluded.error_summary
        where excluded.observed_at >= camera_live_state.observed_at
        """,
        (
            camera_key,
            observed_at,
            _camera_state(status, running, error),
            1 if running else 0,
            max(0, entry_count),
            max(0, exit_count),
            max(0, occupancy_count),
            redact_stream_credentials(str(error))[:500] if error is not None else None,
        ),
    )


def _camera_state(status: Any, running: bool, error: Any) -> str:
    normalized = str(status or "").strip().lower()
    if running or normalized == "running":
        return "running"
    if "reconnect" in normalized or "backoff" in normalized:
        return "reconnecting"
    if error is not None or normalized == "error":
        return "error"
    if normalized in {"connecting", "starting"}:
        return "connecting"
    return "stopped"
