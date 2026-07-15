from __future__ import annotations

import sqlite3
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path

from app.storage.ledger_schema import LOCAL_SCHEMA_VERSION, create_ledger_schema
from app.storage.ledger_state import bind_local_site
from app.storage.reporting_periods import ReportingPeriod

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
                create_ledger_schema(connection)
                connection.execute(f"pragma user_version = {LOCAL_SCHEMA_VERSION}")
                connection.commit()
            except Exception:
                connection.rollback()
                raise
        elif database_version != LOCAL_SCHEMA_VERSION:
            raise RuntimeError(
                "The local ledger schema version is not supported "
                f"(found {database_version}, required {LOCAL_SCHEMA_VERSION}). Remove "
                "the invalid local ledger with scripts/local-data-reset, then start "
                "TANAW to initialize it again."
            )

        _verify_database_integrity(connection)
        _verify_catalog(connection)
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


def _verify_catalog(connection: sqlite3.Connection) -> None:
    expected_object_items, expected_table_items = _catalog_definition()
    expected_objects = dict(expected_object_items)
    expected_tables = dict(expected_table_items)
    actual_objects = _catalog_objects(connection)
    if actual_objects != expected_objects:
        missing = sorted(expected_objects.keys() - actual_objects.keys())
        unexpected = sorted(actual_objects.keys() - expected_objects.keys())
        changed = sorted(
            key
            for key in actual_objects.keys() & expected_objects.keys()
            if actual_objects[key] != expected_objects[key]
        )
        raise RuntimeError(
            "The local ledger catalog does not match the application schema "
            f"(missing={missing}, unexpected={unexpected}, changed={changed})."
        )

    for table_name, expected_columns in expected_tables.items():
        if _table_info(connection, table_name) != expected_columns:
            raise RuntimeError(
                f"The local ledger table {table_name!r} does not match the expected columns."
            )


@lru_cache(maxsize=1)
def _catalog_definition() -> tuple[
    tuple[tuple[tuple[str, str, str], str], ...],
    tuple[tuple[str, tuple[tuple[object, ...], ...]], ...],
]:
    reference = sqlite3.connect(":memory:")
    reference.row_factory = sqlite3.Row
    try:
        _configure_connection(reference)
        create_ledger_schema(reference)
        expected_objects = _catalog_objects(reference)
        expected_tables = sorted(
            name for object_type, name, _ in expected_objects if object_type == "table"
        )
        return (
            tuple(sorted(expected_objects.items())),
            tuple(
                (table_name, _table_info(reference, table_name)) for table_name in expected_tables
            ),
        )
    finally:
        reference.close()


def _catalog_objects(connection: sqlite3.Connection) -> dict[tuple[str, str, str], str]:
    return {
        (str(row["type"]), str(row["name"]), str(row["tbl_name"])): str(row["sql"] or "")
        for row in connection.execute(
            "select type, name, tbl_name, sql from sqlite_master "
            "where name not like 'sqlite_%' order by type, name"
        )
    }


def _table_info(connection: sqlite3.Connection, table_name: str) -> tuple[tuple[object, ...], ...]:
    escaped_name = table_name.replace('"', '""')
    return tuple(tuple(row) for row in connection.execute(f'pragma table_info("{escaped_name}")'))


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
