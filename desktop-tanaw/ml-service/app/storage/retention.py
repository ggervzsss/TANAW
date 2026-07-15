from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any


def purge_expired_identity_data(
    connection: sqlite3.Connection,
    *,
    expires_at_or_before: str,
) -> dict[str, int]:
    visitor_ids = [
        str(row["visitor_id"])
        for row in connection.execute(
            "select visitor_id from visitor_identities where expires_at <= ?",
            (expires_at_or_before,),
        ).fetchall()
    ]
    if not visitor_ids:
        return {"identities": 0, "sightings": 0, "embeddings": 0, "event_links": 0}

    placeholders = ",".join("?" for _ in visitor_ids)
    embedding_count = int(
        connection.execute(
            f"select count(*) from visitor_model_embeddings where visitor_id in ({placeholders})",
            visitor_ids,
        ).fetchone()[0]
    )
    sightings = (
        connection.execute(
            f"delete from visitor_sightings where visitor_id in ({placeholders})",
            visitor_ids,
        ).rowcount
        or 0
    )
    event_links = (
        connection.execute(
            f"update count_events set visitor_id = null where visitor_id in ({placeholders})",
            visitor_ids,
        ).rowcount
        or 0
    )
    identities = (
        connection.execute(
            f"delete from visitor_identities where visitor_id in ({placeholders})",
            visitor_ids,
        ).rowcount
        or 0
    )
    return {
        "identities": int(identities),
        "sightings": int(sightings),
        "embeddings": embedding_count,
        "event_links": int(event_links),
    }


def purge_consolidated_report_raw_data(
    connection: sqlite3.Connection,
    *,
    report_id: str,
    consolidated_revision_id: str,
    purged_at: str,
) -> dict[str, int | str | None]:
    report = connection.execute(
        """
        select report.report_id, report.current_revision_id, report.raw_purged_at,
               outbox.status as outbox_status
        from local_reports as report
        join sync_outbox_items as outbox
          on outbox.report_revision_id = report.current_revision_id
        where report.report_id = ?
        """,
        (report_id,),
    ).fetchone()
    if report is None:
        raise ValueError(f"Unknown local report: {report_id}")
    if str(report["current_revision_id"]) != consolidated_revision_id:
        raise ValueError("The consolidated revision does not match the current local revision.")
    if str(report["outbox_status"]) != "acknowledged":
        raise ValueError(
            "Raw report evidence cannot be purged before exact central acknowledgement."
        )

    event_rows = connection.execute(
        """
        select distinct membership.event_id, event.visitor_id
        from local_report_event_memberships as membership
        join count_events as event on event.event_id = membership.event_id
        where membership.report_revision_id = ?
        """,
        (consolidated_revision_id,),
    ).fetchall()
    event_ids = [str(row["event_id"]) for row in event_rows]
    visitor_ids = sorted({str(row["visitor_id"]) for row in event_rows if row["visitor_id"]})

    purged_events = _delete_ids(connection, "count_events", "event_id", event_ids)
    purged_sightings = _delete_ids(
        connection,
        "visitor_sightings",
        "visitor_id",
        visitor_ids,
    )
    purged_identities = 0
    if visitor_ids:
        placeholders = ",".join("?" for _ in visitor_ids)
        purged_identities = (
            connection.execute(
                f"""
            delete from visitor_identities
            where visitor_id in ({placeholders})
              and not exists (
                  select 1 from count_events
                  where count_events.visitor_id = visitor_identities.visitor_id
              )
            """,
                visitor_ids,
            ).rowcount
            or 0
        )

    previous_purged_at = report["raw_purged_at"]
    next_purged_at = (
        purged_at if purged_events > 0 or previous_purged_at is None else str(previous_purged_at)
    )
    connection.execute(
        "update local_reports set raw_purged_at = ? where report_id = ?",
        (next_purged_at, report_id),
    )
    return {
        "report_id": report_id,
        "revision_id": consolidated_revision_id,
        "purged_events": int(purged_events),
        "purged_sightings": int(purged_sightings),
        "purged_identities": int(purged_identities),
        "raw_purged_at": next_purged_at,
    }


def retention_inventory(connection: sqlite3.Connection, *, root: Path) -> dict[str, Any]:
    raw_table_counts = {
        table: int(connection.execute(f"select count(*) from {table}").fetchone()[0])
        for table in (
            "count_events",
            "visitor_identities",
            "visitor_model_embeddings",
            "visitor_sightings",
        )
    }
    return {
        "raw_table_counts": raw_table_counts,
        "forbidden_disk_artifacts": forbidden_disk_artifacts(root),
    }


def forbidden_disk_artifacts(root: Path) -> list[str]:
    forbidden_names = {
        "active_session.json",
        "events.jsonl",
        "count_snapshots.jsonl",
        "identity_embeddings.npy",
    }
    forbidden_directories = {"snapshots", "embeddings", "visitor-images"}
    return sorted(
        str(path.relative_to(root))
        for path in root.rglob("*")
        if path.name in forbidden_names
        or (path.is_dir() and path.name.casefold() in forbidden_directories)
    )


def _delete_ids(
    connection: sqlite3.Connection,
    table: str,
    column: str,
    values: list[str],
) -> int:
    if not values:
        return 0
    placeholders = ",".join("?" for _ in values)
    return int(
        connection.execute(
            f"delete from {table} where {column} in ({placeholders})",
            values,
        ).rowcount
        or 0
    )
