import runpy
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.exc import SQLAlchemyError

from app.db.migrations import (
    LATEST_DATABASE_REVISION,
    DatabaseMigrationError,
    validate_database_migration_head,
)


@pytest.mark.asyncio
async def test_current_database_revision_is_accepted() -> None:
    connection = MagicMock()
    connection.scalar = AsyncMock(return_value=LATEST_DATABASE_REVISION)

    await validate_database_migration_head(connection)


@pytest.mark.asyncio
async def test_outdated_database_revision_is_rejected() -> None:
    connection = MagicMock()
    connection.scalar = AsyncMock(return_value="20260711_0015")

    with pytest.raises(DatabaseMigrationError, match="migration is out of date"):
        await validate_database_migration_head(connection)


@pytest.mark.asyncio
async def test_uninitialized_database_is_rejected() -> None:
    connection = MagicMock()
    connection.scalar = AsyncMock(side_effect=SQLAlchemyError("missing alembic_version"))

    with pytest.raises(DatabaseMigrationError, match="has not been initialized by Alembic"):
        await validate_database_migration_head(connection)


@pytest.mark.parametrize(
    "migration_filename",
    (
        "20260711_0014_account_activation.py",
        "20260711_0016_reconcile_runtime_schema.py",
    ),
)
def test_irreversible_migrations_block_unsafe_downgrades(migration_filename: str) -> None:
    migration_path = (
        Path(__file__).resolve().parents[1] / "alembic" / "versions" / migration_filename
    )
    migration = runpy.run_path(str(migration_path))

    with pytest.raises(RuntimeError, match="backup"):
        migration["downgrade"]()
