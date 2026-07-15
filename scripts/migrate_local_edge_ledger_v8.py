from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from collections.abc import Iterable
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
ML_SERVICE_ROOT = REPOSITORY_ROOT / "desktop-tanaw" / "ml-service"
sys.path.insert(0, str(ML_SERVICE_ROOT))

from app.storage.ledger_schema import (  # noqa: E402
    TARGET_LOCAL_SCHEMA_VERSION,
    create_target_schema,
)
from app.storage.report_contract import canonical_hash, local_camera_key  # noqa: E402

SUPPORTED_SOURCE_VERSIONS = frozenset({5, 6, 7})


def migrate_local_ledger_v8(database_path: Path) -> Path:
    """Transactionally replace a supported pre-cutover ledger with the exact v8 catalog.

    This function is an external deployment artifact. The target runtime deliberately does
    not import or invoke it. A byte-for-byte SQLite backup remains beside the source if any
    validation or replacement step fails.
    """

    source_path = database_path.resolve()
    backup_path = source_path.with_name(f"{source_path.name}.pre-v8.backup")
    replacement_path = source_path.with_name(f".{source_path.name}.v8.replacement")
    if replacement_path.exists():
        replacement_path.unlink()

    source = _connect(source_path)
    try:
        source_version = int(source.execute("pragma user_version").fetchone()[0])
        if source_version not in SUPPORTED_SOURCE_VERSIONS:
            raise RuntimeError(
                f"Local ledger schema v{source_version} is not a supported v8 cutover source; "
                "expected v5, v6, or v7."
            )
        _require_integrity(source, label="source")
        _create_backup(source, backup_path)
        camera_key_map = _camera_key_map(source)

        target = _connect(replacement_path)
        try:
            target.execute("pragma foreign_keys = off")
            target.execute("begin immediate")
            try:
                create_target_schema(target)
                _copy_source(source, target, camera_key_map=camera_key_map)
                target.execute(f"pragma user_version = {TARGET_LOCAL_SCHEMA_VERSION}")
                target.commit()
            except Exception:
                target.rollback()
                raise
            finally:
                target.execute("pragma foreign_keys = on")
            _require_integrity(target, label="replacement")
            _verify_rehearsal_evidence(source, target)
        finally:
            target.close()
    except Exception:
        replacement_path.unlink(missing_ok=True)
        raise
    finally:
        source.close()

    os.replace(replacement_path, source_path)
    return backup_path


def _connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("pragma busy_timeout = 5000")
    connection.execute("pragma foreign_keys = on")
    return connection


def _create_backup(source: sqlite3.Connection, backup_path: Path) -> None:
    source.execute("pragma wal_checkpoint(full)")
    temporary = backup_path.with_name(f".{backup_path.name}.incomplete")
    temporary.unlink(missing_ok=True)
    backup = sqlite3.connect(temporary)
    try:
        source.backup(backup)
        backup.commit()
    finally:
        backup.close()
    os.replace(temporary, backup_path)


def _camera_key_map(source: sqlite3.Connection) -> dict[str, str]:
    rows = source.execute(
        "select camera_key, central_camera_id, local_camera_id, display_name from local_cameras"
    ).fetchall()
    mapping = {
        str(row["camera_key"]): local_camera_key(
            row["local_camera_id"], row["display_name"], row["central_camera_id"]
        )
        for row in rows
    }
    collisions: dict[str, list[str]] = {}
    for old_key, new_key in mapping.items():
        collisions.setdefault(new_key, []).append(old_key)
    for new_key, old_keys in collisions.items():
        if len(old_keys) == 1:
            continue
        placeholders = ", ".join("?" for _ in old_keys)
        central_ids = {
            str(row[0])
            for row in source.execute(
                f"select central_camera_id from local_cameras "
                f"where camera_key in ({placeholders}) and central_camera_id is not null",
                old_keys,
            )
        }
        if len(central_ids) > 1:
            raise RuntimeError(
                f"Camera identity {new_key} maps to conflicting central cameras: "
                f"{sorted(central_ids)}."
            )
        sequences = [
            (str(row[0]), int(row[1]))
            for row in source.execute(
                f"select camera_key, camera_event_sequence from count_events "
                f"where camera_key in ({placeholders}) order by camera_event_sequence",
                old_keys,
            )
        ]
        values = [sequence for _, sequence in sequences]
        if len(values) != len(set(values)):
            raise RuntimeError(
                f"Camera identity {new_key} has overlapping event sequences across "
                f"pre-binding identities {sorted(old_keys)}; repair explicitly before cutover."
            )
    return mapping


def _copy_source(
    source: sqlite3.Connection,
    target: sqlite3.Connection,
    *,
    camera_key_map: dict[str, str],
) -> None:
    _copy_plain(source, target, "local_sites")
    _copy_plain(source, target, "reporting_periods")
    _copy_cameras(source, target, camera_key_map)
    _copy_plain(source, target, "local_persistence_errors")
    _copy_camera_table(source, target, "camera_live_state", camera_key_map)
    if _table_exists(source, "camera_runtime_state"):
        _copy_camera_table(source, target, "camera_runtime_state", camera_key_map)
    _copy_monitoring_sessions(source, target, camera_key_map)
    _copy_coverage_gaps(source, target, camera_key_map)
    _copy_camera_sequences(source, target, camera_key_map)
    _copy_classified(source, target, "count_events", camera_key_map=camera_key_map)
    _copy_plain(source, target, "visitor_identities")
    _copy_plain(source, target, "visitor_model_embeddings")
    _copy_plain(source, target, "visitor_sightings")
    _copy_classified(source, target, "occupancy_corrections")
    _copy_rollups(source, target, camera_key_map)
    _copy_plain(source, target, "local_reports")
    _copy_classified(source, target, "local_report_revisions")
    _copy_source_batches(source, target, camera_key_map)
    _copy_plain(source, target, "local_report_event_claims")
    _copy_plain(source, target, "local_report_event_memberships")
    _copy_outbox(source, target)
    _copy_plain(source, target, "sync_attempts")
    _synthesize_missing_dead_letter_attempts(target)


def _copy_plain(source: sqlite3.Connection, target: sqlite3.Connection, table: str) -> None:
    if not _table_exists(source, table):
        return
    columns = _common_columns(source, target, table)
    _insert_rows(target, table, columns, source.execute(_select_sql(table, columns)).fetchall())


def _copy_cameras(
    source: sqlite3.Connection, target: sqlite3.Connection, mapping: dict[str, str]
) -> None:
    for row in source.execute("select * from local_cameras order by first_seen_at"):
        target.execute(
            """
            insert into local_cameras (
                camera_key, local_site_id, central_camera_id, local_camera_id,
                display_name, first_seen_at, last_seen_at
            ) values (?, ?, ?, ?, ?, ?, ?)
            on conflict(camera_key) do update set
                central_camera_id = coalesce(excluded.central_camera_id, central_camera_id),
                local_camera_id = coalesce(excluded.local_camera_id, local_camera_id),
                display_name = coalesce(excluded.display_name, display_name),
                first_seen_at = min(first_seen_at, excluded.first_seen_at),
                last_seen_at = max(last_seen_at, excluded.last_seen_at)
            """,
            (
                mapping[str(row["camera_key"])],
                row["local_site_id"],
                row["central_camera_id"],
                row["local_camera_id"],
                row["display_name"],
                row["first_seen_at"],
                row["last_seen_at"],
            ),
        )


def _copy_camera_table(
    source: sqlite3.Connection,
    target: sqlite3.Connection,
    table: str,
    mapping: dict[str, str],
) -> None:
    if not _table_exists(source, table):
        return
    columns = _common_columns(source, target, table)
    rows = []
    for row in source.execute(_select_sql(table, columns)):
        values = dict(row)
        values["camera_key"] = mapping[str(row["camera_key"])]
        rows.append(values)
    _insert_dicts(target, table, columns, rows, replace=True)


def _copy_monitoring_sessions(
    source: sqlite3.Connection, target: sqlite3.Connection, mapping: dict[str, str]
) -> None:
    if not _table_exists(source, "monitoring_sessions"):
        return
    columns = _common_columns(source, target, "monitoring_sessions")
    rows = []
    open_cameras: set[str] = set()
    for row in source.execute(_select_sql("monitoring_sessions", columns)):
        values = dict(row)
        key = mapping[str(row["camera_key"])]
        values["camera_key"] = key
        if row["ended_at"] is None and key in open_cameras:
            raise RuntimeError(f"Camera {key} has more than one open monitoring session.")
        if row["ended_at"] is None:
            open_cameras.add(key)
        rows.append(values)
    _insert_dicts(target, "monitoring_sessions", columns, rows)


def _copy_coverage_gaps(
    source: sqlite3.Connection, target: sqlite3.Connection, mapping: dict[str, str]
) -> None:
    if not _table_exists(source, "coverage_gaps"):
        return
    columns = _common_columns(source, target, "coverage_gaps")
    rows = []
    for row in source.execute(_select_sql("coverage_gaps", columns)):
        values = dict(row)
        values["camera_key"] = mapping[str(row["camera_key"])]
        rows.append(values)
    _insert_dicts(target, "coverage_gaps", columns, rows)


def _copy_camera_sequences(
    source: sqlite3.Connection, target: sqlite3.Connection, mapping: dict[str, str]
) -> None:
    if not _table_exists(source, "local_camera_event_sequences"):
        return
    for row in source.execute("select * from local_camera_event_sequences"):
        target.execute(
            """
            insert into local_camera_event_sequences (camera_key, next_sequence)
            values (?, ?)
            on conflict(camera_key) do update set next_sequence = max(next_sequence, excluded.next_sequence)
            """,
            (mapping[str(row["camera_key"])], row["next_sequence"]),
        )


def _copy_classified(
    source: sqlite3.Connection,
    target: sqlite3.Connection,
    table: str,
    *,
    camera_key_map: dict[str, str] | None = None,
) -> None:
    if not _table_exists(source, table):
        return
    target_columns = _table_columns(target, table)
    source_columns = _table_columns(source, table)
    columns = [
        column
        for column in target_columns
        if column not in {"classification", "simulation_run_id"} and column in source_columns
    ]
    rows: list[dict[str, Any]] = []
    for row in source.execute(f'SELECT * FROM "{table}"'):
        values = {column: row[column] for column in columns}
        classification, simulation_run_id = _classification(row["source_kind"], row["mock_run_id"])
        values["classification"] = classification
        values["simulation_run_id"] = simulation_run_id
        if camera_key_map is not None:
            values["camera_key"] = camera_key_map[str(row["camera_key"])]
        rows.append(values)
    _insert_dicts(target, table, [*columns, "classification", "simulation_run_id"], rows)


def _copy_rollups(
    source: sqlite3.Connection, target: sqlite3.Connection, mapping: dict[str, str]
) -> None:
    if not _table_exists(source, "metric_rollups"):
        return
    columns = [
        column
        for column in _table_columns(target, "metric_rollups")
        if column not in {"classification", "simulation_run_key"}
    ]
    rows = []
    for row in source.execute("select * from metric_rollups"):
        classification, simulation_run_id = _classification(
            row["source_kind"], row["mock_run_key"] or None
        )
        values = {column: row[column] for column in columns}
        values["camera_key"] = mapping[str(row["camera_key"])]
        values["classification"] = classification
        values["simulation_run_key"] = simulation_run_id or ""
        rows.append(values)
    _insert_dicts(
        target,
        "metric_rollups",
        [*columns, "classification", "simulation_run_key"],
        rows,
    )


def _copy_source_batches(
    source: sqlite3.Connection, target: sqlite3.Connection, mapping: dict[str, str]
) -> None:
    if not _table_exists(source, "local_report_source_batches"):
        return
    columns = [
        column
        for column in _table_columns(target, "local_report_source_batches")
        if column not in {"camera_key", "classification", "simulation_run_id"}
    ]
    rows = []
    for row in source.execute("select * from local_report_source_batches"):
        if row["reporting_period_id"] is None:
            raise RuntimeError(f"Source batch {row['batch_id']} has no canonical period.")
        classification, simulation_run_id = _classification(row["source_kind"], row["mock_run_id"])
        values = {column: row[column] for column in columns}
        old_key = str(row["central_camera_key"])
        values.update(
            camera_key=mapping[old_key],
            classification=classification,
            simulation_run_id=simulation_run_id,
        )
        rows.append(values)
    _insert_dicts(
        target,
        "local_report_source_batches",
        [*columns, "camera_key", "classification", "simulation_run_id"],
        rows,
    )


def _copy_outbox(source: sqlite3.Connection, target: sqlite3.Connection) -> None:
    if not _table_exists(source, "sync_outbox_items"):
        return
    columns = _common_columns(source, target, "sync_outbox_items")
    rows = []
    for row in source.execute(_select_sql("sync_outbox_items", columns)):
        values = dict(row)
        status = str(row["status"])
        if status == "acknowledged":
            if not row["acknowledged_at"] or not row["acknowledgement_json"]:
                raise RuntimeError(
                    f"Acknowledged outbox item {row['outbox_item_id']} lacks acknowledgement evidence."
                )
            values["last_error_class"] = None
            values["last_error_message"] = None
        elif row["acknowledged_at"] is not None or row["acknowledgement_json"] is not None:
            raise RuntimeError(
                f"Unacknowledged outbox item {row['outbox_item_id']} has acknowledgement evidence."
            )
        if status == "dead_letter":
            values["attempt_count"] = max(1, int(row["attempt_count"] or 0))
            values["last_attempt_at"] = row["last_attempt_at"] or row["created_at"]
            values["last_error_class"] = row["last_error_class"] or "precutover_dead_letter"
        rows.append(values)
    _insert_dicts(target, "sync_outbox_items", columns, rows)


def _synthesize_missing_dead_letter_attempts(target: sqlite3.Connection) -> None:
    rows = target.execute(
        """
        select outbox.* from sync_outbox_items as outbox
        where outbox.status = 'dead_letter'
          and not exists (
            select 1 from sync_attempts as attempt
            where attempt.outbox_item_id = outbox.outbox_item_id
              and attempt.attempt_number = outbox.attempt_count
          )
        """
    ).fetchall()
    for row in rows:
        target.execute(
            """
            insert into sync_attempts (
                attempt_id, outbox_item_id, attempt_number, attempted_at, completed_at,
                outcome, error_class, error_message
            ) values (?, ?, ?, ?, ?, 'dead_letter', ?, ?)
            """,
            (
                f"precutover:{row['outbox_item_id']}:{row['attempt_count']}",
                row["outbox_item_id"],
                row["attempt_count"],
                row["last_attempt_at"],
                row["last_attempt_at"],
                row["last_error_class"],
                row["last_error_message"],
            ),
        )


def _classification(source_kind: Any, run_id: Any) -> tuple[str, str | None]:
    normalized = str(source_kind or "real")
    normalized_run_id = str(run_id).strip() if run_id is not None else ""
    if normalized == "real":
        if normalized_run_id:
            raise RuntimeError("Official source evidence unexpectedly references a simulation run.")
        return "official", None
    if normalized not in {"mock", "hybrid"}:
        raise RuntimeError(f"Unknown pre-cutover source classification: {normalized!r}.")
    if not normalized_run_id:
        raise RuntimeError("Simulation evidence has no simulation run identity.")
    return "simulation", normalized_run_id


def _verify_rehearsal_evidence(source: sqlite3.Connection, target: sqlite3.Connection) -> None:
    for table in (
        "count_events",
        "local_report_revisions",
        "local_report_event_memberships",
        "sync_outbox_items",
        "sync_attempts",
        "monitoring_sessions",
        "coverage_gaps",
    ):
        if not _table_exists(source, table):
            continue
        source_count = int(source.execute(f'select count(*) from "{table}"').fetchone()[0])
        target_count = int(target.execute(f'select count(*) from "{table}"').fetchone()[0])
        if table == "sync_attempts":
            if target_count < source_count:
                raise RuntimeError("Cutover lost sync-attempt history.")
        elif target_count != source_count:
            raise RuntimeError(
                f"Cutover row-count mismatch for {table}: {source_count} -> {target_count}."
            )
    for batch in target.execute(
        "select batch_id, event_count, event_checksum from local_report_source_batches"
    ):
        event_ids = [
            str(row[0])
            for row in target.execute(
                """
                select event.event_id
                from local_report_event_memberships as membership
                join count_events as event on event.event_id = membership.event_id
                where membership.batch_id = ?
                order by event.camera_event_sequence
                """,
                (batch["batch_id"],),
            )
        ]
        if len(event_ids) != int(batch["event_count"]):
            raise RuntimeError(f"Source batch {batch['batch_id']} has incomplete membership.")
        if f"sha256:{canonical_hash(event_ids)}" != batch["event_checksum"]:
            raise RuntimeError(f"Source batch {batch['batch_id']} has a membership hash mismatch.")


def _require_integrity(connection: sqlite3.Connection, *, label: str) -> None:
    integrity = str(connection.execute("pragma integrity_check").fetchone()[0])
    if integrity != "ok":
        raise RuntimeError(f"The {label} ledger failed integrity_check: {integrity}.")
    failure = connection.execute("pragma foreign_key_check").fetchone()
    if failure is not None:
        raise RuntimeError(
            f"The {label} ledger failed foreign_key_check at {failure['table']} "
            f"row {failure['rowid']}."
        )


def _table_exists(connection: sqlite3.Connection, table: str) -> bool:
    return (
        connection.execute(
            "select 1 from sqlite_master where type = 'table' and name = ?", (table,)
        ).fetchone()
        is not None
    )


def _table_columns(connection: sqlite3.Connection, table: str) -> list[str]:
    return [str(row["name"]) for row in connection.execute(f'pragma table_info("{table}")')]


def _common_columns(
    source: sqlite3.Connection, target: sqlite3.Connection, table: str
) -> list[str]:
    source_columns = set(_table_columns(source, table))
    return [column for column in _table_columns(target, table) if column in source_columns]


def _select_sql(table: str, columns: Iterable[str]) -> str:
    selection = ", ".join(f'"{column}"' for column in columns)
    return f'SELECT {selection} FROM "{table}"'


def _insert_rows(
    target: sqlite3.Connection,
    table: str,
    columns: list[str],
    rows: Iterable[sqlite3.Row],
) -> None:
    _insert_dicts(target, table, columns, (dict(row) for row in rows))


def _insert_dicts(
    target: sqlite3.Connection,
    table: str,
    columns: list[str],
    rows: Iterable[dict[str, Any]],
    *,
    replace: bool = False,
) -> None:
    quoted = ", ".join(f'"{column}"' for column in columns)
    placeholders = ", ".join("?" for _ in columns)
    action = "insert or replace" if replace else "insert"
    target.executemany(
        f'{action} into "{table}" ({quoted}) values ({placeholders})',
        ([row[column] for column in columns] for row in rows),
    )


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Replace a TANAW v5/v6/v7 local ledger with the exact v8 target schema."
    )
    parser.add_argument("database", type=Path)
    return parser.parse_args()


if __name__ == "__main__":
    arguments = _parse_args()
    backup = migrate_local_ledger_v8(arguments.database)
    print(
        json.dumps(
            {
                "schemaVersion": 8,
                "backupPath": str(backup),
                "backupSha256": hashlib.sha256(backup.read_bytes()).hexdigest(),
            },
            sort_keys=True,
        )
    )
