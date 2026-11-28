from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import UniqueConstraint
from sqlalchemy.exc import SQLAlchemyError

from app.db import migrations
from app.db.base import Base
from app.db.migrations import (
    CANONICAL_DATABASE_REVISION,
    DatabaseMigrationError,
    canonical_schema_fingerprint,
    validate_database_migration_head,
)


def test_preproduction_migration_history_has_only_the_canonical_baseline() -> None:
    backend_root = next(
        parent
        for parent in Path(__file__).resolve().parents
        if (parent / "pyproject.toml").exists()
    )
    versions_directory = backend_root / "alembic" / "versions"
    migration_names = sorted(path.name for path in versions_directory.glob("*.py"))

    assert migration_names == [
        "0001_initial_tanaw_schema.py",
    ]


def test_schema_fingerprint_ignores_line_endings_but_detects_schema_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    baseline = tmp_path / "baseline.py"
    monkeypatch.setattr(migrations, "CANONICAL_BASELINE_PATH", baseline)
    baseline.write_bytes(b"# TANAW schema\nrevision = '0001'\n")
    lf_fingerprint = canonical_schema_fingerprint()

    baseline.write_bytes(b"# TANAW schema\r\nrevision = '0001'\r\n")
    assert canonical_schema_fingerprint() == lf_fingerprint

    baseline.write_bytes(b"# Changed TANAW schema\nrevision = '0001'\n")
    assert canonical_schema_fingerprint() != lf_fingerprint


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

    assert len(relationships) == 26
    assert {
        ("enterprise_profiles", ("account_id",), ("accounts.id",)),
        (
            "desktop_local_backups",
            ("enterprise_profile_id",),
            ("enterprise_profiles.account_id",),
        ),
        (
            "enterprise_report_submissions",
            ("enterprise_profile_id",),
            ("enterprise_profiles.account_id",),
        ),
        (
            "enterprise_report_submissions",
            ("previous_version_id",),
            ("enterprise_report_submissions.id",),
        ),
        (
            "enterprise_telemetry_snapshots",
            ("enterprise_profile_id",),
            ("enterprise_profiles.account_id",),
        ),
        (
            "report_submission_operations",
            ("enterprise_profile_id",),
            ("enterprise_profiles.account_id",),
        ),
        (
            "report_submission_operations",
            ("intake_report_id",),
            ("enterprise_report_submissions.id",),
        ),
        (
            "final_report_sources",
            ("intake_report_id",),
            ("enterprise_report_submissions.id",),
        ),
        ("user_notifications", ("recipient_account_id",), ("accounts.id",)),
        ("requests", ("enterprise_profile_id",), ("enterprise_profiles.account_id",)),
        ("requests", ("email_change_request_id",), ("account_email_change_requests.id",)),
        ("requests", ("handled_by_account_id",), ("accounts.id",)),
        ("request_messages", ("author_account_id",), ("accounts.id",)),
        ("request_messages", ("request_id",), ("requests.id",)),
        ("request_reads", ("account_id",), ("accounts.id",)),
        ("request_reads", ("request_id",), ("requests.id",)),
        (
            "enterprise_closures",
            ("enterprise_profile_id",),
            ("enterprise_profiles.account_id",),
        ),
        ("email_outbox", ("account_id",), ("accounts.id",)),
    } <= relationships

    assert "dev_deliveries" not in Base.metadata.tables
    assert "mock_data_runs" not in Base.metadata.tables
    for table in Base.metadata.tables.values():
        assert "source_kind" not in table.columns
        assert "mock_run_id" not in table.columns

    account_columns = set(Base.metadata.tables["accounts"].columns.keys())
    assert {
        "enterprise_id",
        "enterprise_name",
        "category",
        "manager_name",
        "barangay",
        "address",
        "latitude",
        "longitude",
        "location_updated_at",
        "building_capacity",
        "gateway_id",
        "gateway_status",
    }.isdisjoint(account_columns)

    unique_constraints = {
        (
            table.name,
            constraint.name,
            tuple(column.name for column in constraint.columns),
        )
        for table in Base.metadata.tables.values()
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    }
    assert (
        "enterprise_report_submissions",
        "uq_enterprise_report_period_version",
        ("enterprise_profile_id", "period", "version"),
    ) in unique_constraints
    # Returned versions stay on record; only one version per period may be live.
    report_indexes = {
        str(index.name): index
        for index in Base.metadata.tables["enterprise_report_submissions"].indexes
    }
    live_period = report_indexes["uq_enterprise_report_period_live"]
    assert live_period.unique
    assert [column.name for column in live_period.columns] == ["enterprise_profile_id", "period"]
    assert str(live_period.dialect_options["postgresql"]["where"]) == (
        "review_status <> 'Returned'"
    )
    assert (
        "final_report_sources",
        "uq_final_report_source_intake",
        ("intake_report_id",),
    ) in unique_constraints
    assert (
        "report_submission_operations",
        "uq_report_submission_operation_identity",
        ("enterprise_profile_id", "submission_id"),
    ) in unique_constraints

    final_source_columns = set(Base.metadata.tables["final_report_sources"].columns.keys())
    assert {
        "this_prov_male",
        "this_prov_female",
        "this_prov_unspecified",
        "this_city_male",
        "this_city_female",
        "this_city_unspecified",
        "other_prov_male",
        "other_prov_female",
        "foreign_male",
        "foreign_female",
    } <= final_source_columns

    telemetry_indexes = {
        str(index.name): tuple(str(expression) for expression in index.expressions)
        for index in Base.metadata.tables["enterprise_telemetry_snapshots"].indexes
    }
    assert telemetry_indexes["ix_enterprise_telemetry_snapshots_enterprise_received"] == (
        "enterprise_telemetry_snapshots.enterprise_profile_id",
        "enterprise_telemetry_snapshots.received_at DESC",
        "enterprise_telemetry_snapshots.id DESC",
    )
    assert "ix_enterprise_telemetry_snapshots_enterprise_profile_id" not in telemetry_indexes


@pytest.mark.asyncio
async def test_current_database_revision_is_accepted() -> None:
    connection = MagicMock()
    connection.scalar = AsyncMock(
        side_effect=[CANONICAL_DATABASE_REVISION, canonical_schema_fingerprint()]
    )

    await validate_database_migration_head(connection)


@pytest.mark.asyncio
@pytest.mark.parametrize("revision", [None, "0000", "0002"])
async def test_noncanonical_database_revision_is_rejected(revision: str | None) -> None:
    connection = MagicMock()
    connection.scalar = AsyncMock(return_value=revision)

    with pytest.raises(DatabaseMigrationError, match="migration is out of date"):
        await validate_database_migration_head(connection)


@pytest.mark.asyncio
async def test_stale_canonical_schema_fingerprint_is_rejected() -> None:
    connection = MagicMock()
    connection.scalar = AsyncMock(
        side_effect=[CANONICAL_DATABASE_REVISION, "stale-schema-fingerprint"]
    )

    with pytest.raises(DatabaseMigrationError, match="does not match the current canonical schema"):
        await validate_database_migration_head(connection)


@pytest.mark.asyncio
async def test_missing_schema_identity_is_rejected() -> None:
    connection = MagicMock()
    connection.scalar = AsyncMock(
        side_effect=[CANONICAL_DATABASE_REVISION, SQLAlchemyError("missing schema identity")]
    )

    with pytest.raises(DatabaseMigrationError, match="does not match the current canonical schema"):
        await validate_database_migration_head(connection)


@pytest.mark.asyncio
async def test_uninitialized_database_is_rejected() -> None:
    connection = MagicMock()
    connection.scalar = AsyncMock(side_effect=SQLAlchemyError("missing alembic_version"))

    with pytest.raises(DatabaseMigrationError, match="has not been initialized by Alembic"):
        await validate_database_migration_head(connection)
