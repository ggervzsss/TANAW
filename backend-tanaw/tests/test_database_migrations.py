from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.exc import SQLAlchemyError

from app.db.base import Base
from app.db.migrations import (
    LATEST_DATABASE_REVISION,
    DatabaseMigrationError,
    validate_database_migration_head,
)


def test_migration_history_has_one_canonical_baseline() -> None:
    versions_directory = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    migration_names = sorted(path.name for path in versions_directory.glob("*.py"))

    assert migration_names == ["20260720_0001_initial_tanaw_schema.py"]


def test_canonical_schema_enforces_owned_record_relationships() -> None:
    relationships = {
        (
            table.name,
            tuple(column.name for column in constraint.columns),
            tuple(element.target_fullname for element in constraint.elements),
        )
        for table in Base.metadata.tables.values()
        for constraint in table.foreign_key_constraints
    }

    assert len(relationships) == 29
    assert {
        (
            "enterprise_report_submissions",
            ("enterprise_account_id",),
            ("accounts.id",),
        ),
        (
            "enterprise_report_submissions",
            ("enterprise_id",),
            ("accounts.enterprise_id",),
        ),
        (
            "enterprise_telemetry_snapshots",
            ("enterprise_account_id",),
            ("accounts.id",),
        ),
        (
            "final_report_sources",
            ("intake_report_id",),
            ("enterprise_report_submissions.id",),
        ),
        ("user_notifications", ("recipient_account_id",), ("accounts.id",)),
        (
            "user_notifications",
            ("recipient_enterprise_id",),
            ("accounts.enterprise_id",),
        ),
        ("support_tickets", ("enterprise_account_id",), ("accounts.id",)),
        (
            "support_ticket_messages",
            ("author_account_id",),
            ("accounts.id",),
        ),
        ("email_outbox", ("account_id",), ("accounts.id",)),
        ("dev_deliveries", ("account_id",), ("accounts.id",)),
    } <= relationships


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
