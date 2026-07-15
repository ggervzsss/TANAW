import os
import re
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from sqlalchemy import PrimaryKeyConstraint, UniqueConstraint, text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from app.db.base import Base

TEST_DATABASE_ENV = "TANAW_TEST_DATABASE_URL"
TARGET_MIGRATION_HEAD = "20260715_0041"
PARTITION_NAME = re.compile(r"^site_telemetry_hourly_rollups_\d{6}$")

APPROVED_SEQUENCES = {
    "operational_alert_code_seq",
    "report_finalization_code_seq",
    "support_ticket_code_seq",
}

APPROVED_TRIGGERS = {
    (
        "device_health_samples",
        "trg_device_health_samples_append_only",
        "tanaw_reject_append_only_update",
    ),
    (
        "device_telemetry_epochs",
        "trg_device_telemetry_epochs_guard",
        "tanaw_guard_device_telemetry_epoch",
    ),
    (
        "domain_event_consumer_receipts",
        "trg_domain_event_consumer_receipts_append_only",
        "tanaw_reject_append_only_update",
    ),
    (
        "domain_event_consumer_receipts",
        "trg_domain_event_consumer_receipts_hash",
        "tanaw_validate_domain_event_consumer_receipt",
    ),
    (
        "domain_event_deliveries",
        "trg_domain_event_deliveries_guard",
        "tanaw_guard_domain_event_delivery",
    ),
    (
        "domain_event_delivery_attempts",
        "trg_domain_event_delivery_attempts_append_only",
        "tanaw_reject_append_only_update",
    ),
    ("domain_events", "trg_domain_events_append_only", "tanaw_reject_append_only_update"),
    (
        "enterprise_reports",
        "trg_enterprise_reports_acceptance_guard",
        "tanaw_enforce_report_acceptance_unblocked",
    ),
    (
        "final_report_artifacts",
        "trg_final_report_artifacts_lifecycle_guard",
        "tanaw_guard_final_report_artifact_mutation",
    ),
    (
        "final_report_command_receipts",
        "trg_final_report_command_receipts_immutable",
        "tanaw_reject_immutable_reporting_mutation",
    ),
    (
        "final_report_demographic_facts",
        "trg_final_report_demographic_facts_immutable",
        "tanaw_reject_immutable_reporting_mutation",
    ),
    (
        "final_report_events",
        "trg_final_report_events_immutable",
        "tanaw_reject_immutable_reporting_mutation",
    ),
    (
        "final_report_items",
        "trg_final_report_items_immutable",
        "tanaw_reject_immutable_reporting_mutation",
    ),
    (
        "final_report_metric_facts",
        "trg_final_report_metric_facts_immutable",
        "tanaw_reject_immutable_reporting_mutation",
    ),
    (
        "final_report_scope_members",
        "trg_final_report_scope_members_immutable",
        "tanaw_reject_immutable_reporting_mutation",
    ),
    (
        "final_report_source_claims",
        "trg_final_report_source_claims_immutable",
        "tanaw_reject_immutable_reporting_mutation",
    ),
    (
        "final_report_versions",
        "trg_final_report_versions_immutable",
        "tanaw_guard_final_report_version_mutation",
    ),
    (
        "report_demographic_facts",
        "trg_report_demographic_facts_immutable",
        "tanaw_reject_immutable_reporting_mutation",
    ),
    (
        "report_finalizations",
        "trg_report_finalizations_version_guard",
        "tanaw_guard_report_finalization_mutation",
    ),
    (
        "report_intake_receipts",
        "trg_report_intake_receipts_immutable",
        "tanaw_reject_immutable_reporting_mutation",
    ),
    (
        "report_metric_facts",
        "trg_report_metric_facts_immutable",
        "tanaw_reject_immutable_reporting_mutation",
    ),
    (
        "report_review_events",
        "trg_report_review_events_immutable",
        "tanaw_reject_immutable_reporting_mutation",
    ),
    (
        "report_revisions",
        "trg_report_revisions_immutable",
        "tanaw_reject_immutable_reporting_mutation",
    ),
    (
        "report_source_batches",
        "trg_report_source_batches_immutable",
        "tanaw_reject_immutable_reporting_mutation",
    ),
    (
        "reporting_obligations",
        "trg_reporting_obligations_identity_immutable",
        "tanaw_guard_reporting_obligation_identity",
    ),
    (
        "reporting_periods",
        "trg_reporting_periods_canonical",
        "tanaw_validate_canonical_reporting_period",
    ),
    (
        "reporting_periods",
        "trg_reporting_periods_immutable",
        "tanaw_guard_reporting_period_mutation",
    ),
    ("site_live_state", "trg_site_live_state_monotonic", "tanaw_guard_site_live_state_monotonic"),
    (
        "site_location_versions",
        "trg_site_location_versions_immutable",
        "tanaw_guard_site_location_version",
    ),
    (
        "telemetry_metric_facts",
        "trg_telemetry_metric_facts_append_only",
        "tanaw_reject_append_only_update",
    ),
    (
        "telemetry_observations",
        "trg_telemetry_observations_append_only",
        "tanaw_guard_telemetry_observation_update",
    ),
    (
        "telemetry_observations",
        "trg_telemetry_observations_retention_delete",
        "tanaw_guard_telemetry_observation_delete",
    ),
}

APPROVED_FUNCTIONS = {
    "tanaw_enforce_report_acceptance_unblocked",
    "tanaw_guard_device_telemetry_epoch",
    "tanaw_guard_domain_event_delivery",
    "tanaw_guard_final_report_artifact_mutation",
    "tanaw_guard_final_report_version_mutation",
    "tanaw_guard_report_finalization_mutation",
    "tanaw_guard_reporting_obligation_identity",
    "tanaw_guard_reporting_period_mutation",
    "tanaw_guard_site_live_state_monotonic",
    "tanaw_guard_site_location_version",
    "tanaw_guard_telemetry_observation_delete",
    "tanaw_guard_telemetry_observation_update",
    "tanaw_reject_append_only_update",
    "tanaw_reject_immutable_reporting_mutation",
    "tanaw_validate_canonical_reporting_period",
    "tanaw_validate_domain_event_consumer_receipt",
}

FORBIDDEN_ACCOUNT_COLUMNS = {
    "address",
    "barangay",
    "building_capacity",
    "category",
    "enterprise_id",
    "enterprise_name",
    "gateway_id",
    "gateway_status",
    "geocoded_address",
    "latitude",
    "location_confidence",
    "location_source",
    "location_updated_at",
    "longitude",
    "manager_name",
    "mock_run_id",
    "preferences_json",
    "source_kind",
}


def _postgres_async_url(raw_url: str) -> str:
    normalized = raw_url.strip()
    if normalized.startswith("postgres://"):
        normalized = f"postgresql://{normalized.removeprefix('postgres://')}"
    if normalized.startswith("postgresql://"):
        normalized = normalized.replace("postgresql://", "postgresql+asyncpg://", 1)
    if not normalized.startswith("postgresql+asyncpg://"):
        raise pytest.UsageError(f"{TEST_DATABASE_ENV} must point to PostgreSQL via asyncpg.")
    return normalized


@pytest_asyncio.fixture
async def catalog_connection() -> AsyncIterator[AsyncConnection]:
    raw_url = os.getenv(TEST_DATABASE_ENV)
    if not raw_url:
        pytest.skip(f"{TEST_DATABASE_ENV} is not configured.")
    engine = create_async_engine(_postgres_async_url(raw_url), pool_pre_ping=True)
    async with engine.connect() as connection:
        yield connection
    await engine.dispose()


@pytest.mark.asyncio
async def test_public_catalog_is_exactly_the_target_erd(
    catalog_connection: AsyncConnection,
) -> None:
    migration_head = await catalog_connection.scalar(
        text("SELECT version_num FROM alembic_version")
    )
    assert migration_head == TARGET_MIGRATION_HEAD

    table_names = set(
        await catalog_connection.scalars(
            text("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        )
    )
    partition_names = set(
        await catalog_connection.scalars(
            text(
                "SELECT child.relname "
                "FROM pg_inherits inheritance "
                "JOIN pg_class parent ON parent.oid = inheritance.inhparent "
                "JOIN pg_class child ON child.oid = inheritance.inhrelid "
                "JOIN pg_namespace namespace ON namespace.oid = child.relnamespace "
                "WHERE namespace.nspname = 'public' "
                "AND parent.relname = 'site_telemetry_hourly_rollups'"
            )
        )
    )
    assert partition_names
    assert all(PARTITION_NAME.fullmatch(name) for name in partition_names)
    assert table_names == set(Base.metadata.tables) | {"alembic_version"} | partition_names

    views_or_foreign_tables = set(
        await catalog_connection.scalars(
            text(
                "SELECT relation.relname FROM pg_class relation "
                "JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace "
                "WHERE namespace.nspname = 'public' AND relation.relkind IN ('v', 'm', 'f')"
            )
        )
    )
    assert views_or_foreign_tables == set()


@pytest.mark.asyncio
async def test_target_columns_match_models_and_forbidden_columns_are_absent(
    catalog_connection: AsyncConnection,
) -> None:
    rows = (
        await catalog_connection.execute(
            text(
                "SELECT table_name, column_name FROM information_schema.columns "
                "WHERE table_schema = 'public' ORDER BY table_name, ordinal_position"
            )
        )
    ).all()
    actual_columns: dict[str, set[str]] = {}
    for table_name, column_name in rows:
        actual_columns.setdefault(table_name, set()).add(column_name)

    for table_name, table in Base.metadata.tables.items():
        assert actual_columns[table_name] == {column.name for column in table.columns}, table_name
    assert actual_columns["accounts"].isdisjoint(FORBIDDEN_ACCOUNT_COLUMNS)
    assert "attachments_json" not in actual_columns["support_tickets"]


@pytest.mark.asyncio
async def test_no_shadow_schema_objects_survive_cutover(
    catalog_connection: AsyncConnection,
) -> None:
    sequences = set(
        await catalog_connection.scalars(
            text(
                "SELECT sequence_name FROM information_schema.sequences "
                "WHERE sequence_schema = 'public'"
            )
        )
    )
    assert sequences == APPROVED_SEQUENCES

    triggers = {
        (table_name, trigger_name, function_name)
        for table_name, trigger_name, function_name in (
            await catalog_connection.execute(
                text(
                    "SELECT relation.relname, trigger.tgname, function.proname "
                    "FROM pg_trigger trigger "
                    "JOIN pg_class relation ON relation.oid = trigger.tgrelid "
                    "JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace "
                    "JOIN pg_proc function ON function.oid = trigger.tgfoid "
                    "WHERE namespace.nspname = 'public' AND NOT trigger.tgisinternal"
                )
            )
        ).all()
    }
    assert triggers == APPROVED_TRIGGERS

    functions = set(
        await catalog_connection.scalars(
            text(
                "SELECT procedure.proname FROM pg_proc procedure "
                "JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace "
                "WHERE namespace.nspname = 'public' AND NOT EXISTS ("
                "SELECT 1 FROM pg_depend dependency "
                "JOIN pg_extension extension ON extension.oid = dependency.refobjid "
                "WHERE dependency.objid = procedure.oid AND dependency.deptype = 'e')"
            )
        )
    )
    assert functions == APPROVED_FUNCTIONS


@pytest.mark.asyncio
async def test_nonpartition_indexes_match_target_metadata(
    catalog_connection: AsyncConnection,
) -> None:
    expected_indexes = {"alembic_version_pkc"}
    for table in Base.metadata.tables.values():
        expected_indexes.update(index.name for index in table.indexes if index.name)
        for constraint in table.constraints:
            if isinstance(constraint, PrimaryKeyConstraint):
                expected_indexes.add(
                    str(constraint.name)
                    if constraint.name
                    else (
                        "pk_site_telemetry_hourly_rollups"
                        if table.name == "site_telemetry_hourly_rollups"
                        else f"{table.name}_pkey"
                    )
                )
            elif isinstance(constraint, UniqueConstraint):
                expected_indexes.add(
                    str(constraint.name)
                    if constraint.name
                    else f"{table.name}_{'_'.join(column.name for column in constraint.columns)}_key"
                )
        expected_indexes.update(
            str(constraint.name)
            for constraint in table.constraints
            if constraint.__class__.__name__ == "ExcludeConstraint" and constraint.name
        )

    actual_indexes = set(
        await catalog_connection.scalars(
            text(
                "SELECT index.indexname FROM pg_indexes index "
                "WHERE index.schemaname = 'public' AND NOT EXISTS ("
                "SELECT 1 FROM pg_inherits inheritance "
                "JOIN pg_class child ON child.oid = inheritance.inhrelid "
                "WHERE child.relname = index.tablename)"
            )
        )
    )
    assert actual_indexes == expected_indexes


@pytest.mark.asyncio
async def test_every_foreign_key_uses_the_same_native_database_type(
    catalog_connection: AsyncConnection,
) -> None:
    mismatches = (
        await catalog_connection.execute(
            text(
                "SELECT source_table.relname, source_column.attname, "
                "format_type(source_column.atttypid, source_column.atttypmod), "
                "target_table.relname, target_column.attname, "
                "format_type(target_column.atttypid, target_column.atttypmod) "
                "FROM pg_constraint constraint_record "
                "JOIN pg_class source_table ON source_table.oid = constraint_record.conrelid "
                "JOIN pg_class target_table ON target_table.oid = constraint_record.confrelid "
                "JOIN LATERAL unnest(constraint_record.conkey) WITH ORDINALITY source_keys(attnum, ordinal) ON true "
                "JOIN LATERAL unnest(constraint_record.confkey) WITH ORDINALITY target_keys(attnum, ordinal) "
                "ON target_keys.ordinal = source_keys.ordinal "
                "JOIN pg_attribute source_column ON source_column.attrelid = source_table.oid "
                "AND source_column.attnum = source_keys.attnum "
                "JOIN pg_attribute target_column ON target_column.attrelid = target_table.oid "
                "AND target_column.attnum = target_keys.attnum "
                "JOIN pg_namespace namespace ON namespace.oid = source_table.relnamespace "
                "WHERE namespace.nspname = 'public' AND constraint_record.contype = 'f' "
                "AND source_column.atttypid != target_column.atttypid"
            )
        )
    ).all()
    assert mismatches == []
