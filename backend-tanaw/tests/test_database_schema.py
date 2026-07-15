import runpy
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.exc import SQLAlchemyError

from app.db.schema_version import (
    LATEST_DATABASE_REVISION,
    DatabaseSchemaError,
    validate_database_schema,
)

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"
INITIAL_SCHEMA_PATH = VERSIONS_DIR / "20260715_0001_create_initial_schema.py"
DATABASE_DDL_PATH = VERSIONS_DIR / "20260715_0001_database_ddl.sql"


@pytest.mark.asyncio
async def test_current_database_revision_is_accepted() -> None:
    connection = MagicMock()
    connection.scalar = AsyncMock(return_value=LATEST_DATABASE_REVISION)

    await validate_database_schema(connection)


@pytest.mark.asyncio
async def test_unsupported_database_revision_is_rejected() -> None:
    connection = MagicMock()
    connection.scalar = AsyncMock(return_value="unsupported-revision")

    with pytest.raises(DatabaseSchemaError, match="schema version is not supported"):
        await validate_database_schema(connection)


@pytest.mark.asyncio
async def test_uninitialized_database_is_rejected() -> None:
    connection = MagicMock()
    connection.scalar = AsyncMock(side_effect=SQLAlchemyError("missing alembic_version"))

    with pytest.raises(DatabaseSchemaError, match="schema has not been initialized"):
        await validate_database_schema(connection)


def test_repository_contains_one_initial_schema_revision() -> None:
    migration_files = sorted(
        path.name for path in VERSIONS_DIR.glob("*.py") if path.name != "__init__.py"
    )

    assert migration_files == [INITIAL_SCHEMA_PATH.name]
    migration = runpy.run_path(str(INITIAL_SCHEMA_PATH))
    assert migration["revision"] == LATEST_DATABASE_REVISION == "20260715_0001"
    assert migration["down_revision"] is None
    assert DATABASE_DDL_PATH.is_file()


def test_initial_revision_installs_database_support_objects() -> None:
    initial_schema = INITIAL_SCHEMA_PATH.read_text(encoding="utf-8")
    database_ddl = DATABASE_DDL_PATH.read_text(encoding="utf-8")

    for required in (
        "CREATE SEQUENCE operational_alert_code_seq",
        "CREATE SEQUENCE report_finalization_code_seq",
        "CREATE SEQUENCE support_ticket_code_seq",
        "CREATE OR REPLACE FUNCTION public.tanaw_guard_site_live_state_monotonic",
        "CREATE TRIGGER trg_site_live_state_monotonic",
        "CREATE TABLE IF NOT EXISTS %I PARTITION OF ",
        "site_telemetry_hourly_rollups FOR VALUES",
    ):
        assert required in database_ddl

    assert "_install_database_ddl" in initial_schema


def test_initial_revision_blocks_destructive_downgrade() -> None:
    migration = runpy.run_path(str(INITIAL_SCHEMA_PATH))

    with pytest.raises(RuntimeError, match="database backup"):
        migration["downgrade"]()
