from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from app.storage.ledger_schema import TARGET_LOCAL_SCHEMA_VERSION, create_target_schema
from app.storage.reporting_periods import ReportingPeriod
from app.storage.target_schema import bind_local_site

LOCAL_SCHEMA_VERSION = TARGET_LOCAL_SCHEMA_VERSION
SQLITE_BUSY_TIMEOUT_MS = 5_000


def connect_local_database(
    database_path: Path,
    *,
    cross_thread: bool = False,
) -> sqlite3.Connection:
    connection = sqlite3.connect(
        database_path,
        timeout=SQLITE_BUSY_TIMEOUT_MS / 1_000,
        check_same_thread=not cross_thread,
    )
    connection.row_factory = sqlite3.Row
    _configure_connection(connection)
    return connection


def initialize_local_database(database_path: Path, *, enterprise_id: str | None = None) -> None:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(
        database_path,
        timeout=SQLITE_BUSY_TIMEOUT_MS / 1_000,
        isolation_level=None,
    )
    connection.row_factory = sqlite3.Row
    try:
        _configure_connection(connection)
        connection.execute("pragma journal_mode = wal")
        connection.execute("pragma synchronous = normal")
        database_version = int(connection.execute("pragma user_version").fetchone()[0])
        existing_tables = {
            str(row["name"])
            for row in connection.execute(
                "select name from sqlite_master where type = 'table' and name not like 'sqlite_%'"
            )
        }
        if database_version == 0 and not existing_tables:
            connection.execute("begin immediate")
            try:
                create_target_schema(connection)
                connection.execute(f"pragma user_version = {LOCAL_SCHEMA_VERSION}")
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        elif database_version != LOCAL_SCHEMA_VERSION:
            raise RuntimeError(
                "This TANAW build accepts only the target local-ledger schema "
                f"version {LOCAL_SCHEMA_VERSION} (found {database_version}). Run the "
                "coordinated pre-cutover migration before installing this build; target "
                "runtime does not contain compatibility migrations."
            )

        _verify_database_integrity(connection)
        _verify_target_catalog(connection)
        bind_local_site(connection, enterprise_id=enterprise_id)
        connection.commit()
    finally:
        connection.close()


def _configure_connection(connection: sqlite3.Connection) -> None:
    connection.execute("pragma foreign_keys = on")
    connection.execute("pragma secure_delete = on")
    connection.execute(f"pragma busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")


def _verify_database_integrity(connection: sqlite3.Connection) -> None:
    integrity = str(connection.execute("pragma integrity_check").fetchone()[0])
    if integrity != "ok":
        raise RuntimeError(f"Local ledger integrity check failed: {integrity}")
    foreign_key_failure = connection.execute("pragma foreign_key_check").fetchone()
    if foreign_key_failure is not None:
        raise RuntimeError(
            "Local ledger foreign-key check failed for "
            f"{foreign_key_failure['table']} row {foreign_key_failure['rowid']}."
        )


def _verify_target_catalog(connection: sqlite3.Connection) -> None:
    forbidden_tables = {"count_snapshots", "report_submissions", "local_schema_migrations"}
    tables = {
        str(row["name"])
        for row in connection.execute(
            "select name from sqlite_master where type = 'table' and name not like 'sqlite_%'"
        )
    }
    remaining = sorted(forbidden_tables & tables)
    if remaining:
        raise RuntimeError(
            "Superseded local-ledger objects are not accepted by the target runtime: "
            + ", ".join(remaining)
        )
    columns = {str(row["name"]) for row in connection.execute("pragma table_info(count_events)")}
    required_columns = {
        "event_id",
        "business_date",
        "reporting_period_id",
        "camera_key",
        "camera_event_sequence",
        "attributes_json",
    }
    if not required_columns <= columns:
        raise RuntimeError("The local event ledger does not match the target catalog.")
    forbidden_columns = {"payload_json", "submitted_report_id", "synced_at"}
    remaining_columns = sorted(forbidden_columns & columns)
    if remaining_columns:
        raise RuntimeError(
            "Superseded event-ledger columns are not accepted by the target runtime: "
            + ", ".join(remaining_columns)
        )


def upsert_reporting_period(connection: sqlite3.Connection, period: ReportingPeriod) -> None:
    connection.execute(
        """
        insert into reporting_periods (
            period_id,
            period_type,
            timezone,
            business_start_date,
            business_end_date_exclusive,
            starts_at_utc,
            ends_at_utc,
            label,
            created_at
        )
        values (?, 'month', ?, ?, ?, ?, ?, ?, ?)
        on conflict(period_id) do nothing
        """,
        (
            period.period_id,
            period.timezone,
            period.business_start_date.isoformat(),
            period.business_end_date_exclusive.isoformat(),
            period.starts_at_utc.isoformat(),
            period.ends_at_utc.isoformat(),
            period.label,
            datetime.now(UTC).isoformat(),
        ),
    )
