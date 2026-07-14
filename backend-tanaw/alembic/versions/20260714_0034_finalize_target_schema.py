"""Finalize the target-only reporting and telemetry schema.

Revision ID: 20260714_0034
Revises: 20260714_0033

The cutover exception ledgers have no runtime purpose after every source row has
been reconciled and the superseded source tables have been removed. This
migration fails closed on unresolved exceptions, preserves imported target rows
under neutral evidence labels, and then permanently removes both ledgers.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from alembic import op

revision: str = "20260714_0034"
down_revision: str | Sequence[str] | None = "20260714_0033"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    connection = op.get_bind()
    _require_closed_exception_ledgers(connection)

    op.drop_constraint(
        "ck_reporting_obligations_eligibility_basis",
        "reporting_obligations",
        type_="check",
    )
    op.execute(
        "UPDATE reporting_obligations "
        "SET eligibility_basis = 'migration_evidence' "
        "WHERE eligibility_basis = 'legacy_submission'"
    )
    op.create_check_constraint(
        "ck_reporting_obligations_eligibility_basis",
        "reporting_obligations",
        "eligibility_basis IN ('registry_snapshot', 'migration_evidence', 'manual_resolution')",
    )

    op.drop_constraint("ck_report_review_events_type", "report_review_events", type_="check")
    op.execute(
        "UPDATE report_review_events "
        "SET event_type = 'migration_state_imported' "
        "WHERE event_type = 'legacy_state_imported'"
    )
    op.create_check_constraint(
        "ck_report_review_events_type",
        "report_review_events",
        "event_type IN ('revision_submitted', 'returned', 'accepted', 'reopened', "
        "'consolidated', 'migration_state_imported')",
    )

    op.drop_constraint("ck_final_report_events_versions", "final_report_events", type_="check")
    op.drop_constraint("ck_final_report_events_type", "final_report_events", type_="check")
    op.execute(
        "UPDATE final_report_events "
        "SET event_type = 'migration_final_imported' "
        "WHERE event_type = 'legacy_final_imported'"
    )
    op.create_check_constraint(
        "ck_final_report_events_type",
        "final_report_events",
        "event_type IN ('version_finalized', 'migration_final_imported', "
        "'artifact_ready', 'artifact_failed', 'artifact_retry_scheduled', "
        "'artifact_repair_requested')",
    )
    op.create_check_constraint(
        "ck_final_report_events_versions",
        "final_report_events",
        "((event_type IN ('version_finalized', 'migration_final_imported') AND "
        "final_report_artifact_id IS NULL AND expected_version >= 0 AND "
        "resulting_version > expected_version) OR "
        "(event_type IN ('artifact_ready', 'artifact_failed', "
        "'artifact_retry_scheduled', 'artifact_repair_requested') AND "
        "final_report_artifact_id IS NOT NULL AND expected_version = resulting_version "
        "AND resulting_version >= 1))",
    )

    op.drop_constraint(
        "ck_telemetry_observations_ordering_evidence",
        "telemetry_observations",
        type_="check",
    )
    op.drop_constraint(
        "ck_telemetry_observations_ordering_status",
        "telemetry_observations",
        type_="check",
    )
    op.execute(
        "UPDATE telemetry_observations "
        "SET ordering_status = 'unsequenced_import' "
        "WHERE ordering_status = 'unsequenced_legacy'"
    )
    op.create_check_constraint(
        "ck_telemetry_observations_ordering_status",
        "telemetry_observations",
        "ordering_status IN ('sequenced', 'unsequenced_import')",
    )
    op.create_check_constraint(
        "ck_telemetry_observations_ordering_evidence",
        "telemetry_observations",
        "(ingest_kind = 'command' AND ordering_status = 'sequenced' "
        "AND edge_device_id IS NOT NULL AND telemetry_epoch_id IS NOT NULL "
        "AND epoch_generation >= 1 AND sequence >= 0 AND command_id IS NOT NULL "
        "AND idempotency_key IS NOT NULL) OR "
        "(ingest_kind = 'migration' AND ordering_status = 'unsequenced_import' "
        "AND telemetry_epoch_id IS NULL AND epoch_generation IS NULL "
        "AND sequence IS NULL AND command_id IS NULL AND idempotency_key IS NULL "
        "AND became_current = false)",
    )

    op.drop_index(
        "uq_telemetry_metric_facts_legacy_definition",
        table_name="telemetry_metric_facts",
    )
    for constraint_name in (
        "ck_telemetry_metric_facts_window_evidence",
        "ck_telemetry_metric_facts_camera_grain",
        "ck_telemetry_metric_facts_grain",
        "ck_telemetry_metric_facts_status",
    ):
        op.drop_constraint(constraint_name, "telemetry_metric_facts", type_="check")
    op.execute(
        "UPDATE telemetry_metric_facts "
        "SET fact_status = 'unqualified_import', grain = 'import_unspecified' "
        "WHERE fact_status = 'unqualified_legacy' OR grain = 'legacy_unspecified'"
    )
    op.create_check_constraint(
        "ck_telemetry_metric_facts_status",
        "telemetry_metric_facts",
        "fact_status IN ('qualified', 'unqualified_import')",
    )
    op.create_check_constraint(
        "ck_telemetry_metric_facts_grain",
        "telemetry_metric_facts",
        "grain IN ('camera', 'site', 'import_unspecified')",
    )
    op.create_check_constraint(
        "ck_telemetry_metric_facts_camera_grain",
        "telemetry_metric_facts",
        "(grain = 'camera' AND camera_id IS NOT NULL) OR "
        "(grain IN ('site', 'import_unspecified') AND camera_id IS NULL)",
    )
    op.create_check_constraint(
        "ck_telemetry_metric_facts_window_evidence",
        "telemetry_metric_facts",
        "(fact_status = 'qualified' AND grain IN ('camera', 'site') "
        "AND metric_window_start IS NOT NULL AND metric_window_end IS NOT NULL "
        "AND metric_window_end > metric_window_start) OR "
        "(fact_status = 'unqualified_import' AND grain = 'import_unspecified' "
        "AND metric_window_start IS NULL AND metric_window_end IS NULL "
        "AND coverage_evidence_status = 'not_recorded')",
    )
    op.create_index(
        "uq_telemetry_metric_facts_import_definition",
        "telemetry_metric_facts",
        ["telemetry_observation_id", "definition", "definition_version"],
        unique=True,
        postgresql_where=sa.text("grain = 'import_unspecified'"),
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION tanaw_enforce_report_acceptance_unblocked()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.workflow_state IN ('accepted', 'consolidated')
               AND NEW.acceptance_blocked = true THEN
                RAISE EXCEPTION 'Blocked report cannot enter accepted or consolidated state';
            END IF;
            IF NEW.acceptance_blocked = false
               OR NEW.workflow_state IN ('accepted', 'consolidated') THEN
                IF EXISTS (
                    SELECT 1 FROM reporting_obligations obligation
                    WHERE obligation.id = NEW.reporting_obligation_id
                      AND obligation.acceptance_blocked = true
                ) OR EXISTS (
                    SELECT 1 FROM report_revisions revision
                    WHERE revision.id = NEW.current_revision_id
                      AND revision.acceptance_blocked = true
                ) OR EXISTS (
                    SELECT 1 FROM report_revisions revision
                    WHERE revision.id = NEW.accepted_revision_id
                      AND revision.acceptance_blocked = true
                ) THEN
                    RAISE EXCEPTION
                        'Report acceptance remains blocked by incomplete evidence';
                END IF;
            END IF;
            RETURN NEW;
        END;
        $$
        """
    )

    op.drop_table("report_migration_exceptions")
    op.drop_table("telemetry_migration_exceptions")


def _require_closed_exception_ledgers(connection: Connection) -> None:
    open_reports = int(
        connection.scalar(
            sa.text("SELECT count(*) FROM report_migration_exceptions WHERE status = 'open'")
        )
        or 0
    )
    open_telemetry = int(
        connection.scalar(
            sa.text("SELECT count(*) FROM telemetry_migration_exceptions WHERE status = 'open'")
        )
        or 0
    )
    if open_reports or open_telemetry:
        raise RuntimeError(
            "Target schema finalization blocked: resolve or waive every migration "
            f"exception first (report={open_reports}, telemetry={open_telemetry})."
        )


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260714_0034 permanently removes cutover ledgers and compatibility "
        "labels. Restore the verified external pre-cutover backup and matching "
        "application build instead."
    )
