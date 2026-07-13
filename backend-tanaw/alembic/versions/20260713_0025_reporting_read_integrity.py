"""Preserve reporting presentation identity and add target read access paths.

Revision ID: 20260713_0025
Revises: 20260713_0024

Actor names and final-scope presentation identity become immutable facts rather
than mutable account/topology lookups. Existing rows are backfilled only from
their enforced foreign-key parents. This revision also adds the physical
keyset/filter access paths used by the Staff report and final-report readers.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260713_0025"
down_revision: str | Sequence[str] | None = "20260713_0024"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    _add_snapshot_columns()
    _backfill_snapshot_facts()
    _enforce_snapshot_constraints()
    _create_read_indexes()


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260713_0025 is intentionally irreversible because actor and "
        "final-scope identity snapshots are durable audit evidence. Restore the verified "
        "pre-cutover backup and matching application build instead."
    )


def _add_snapshot_columns() -> None:
    op.add_column(
        "report_review_events",
        sa.Column("actor_display_name", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "final_report_events",
        sa.Column("actor_display_name", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "final_report_scope_members",
        sa.Column("enterprise_official_code", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "final_report_scope_members",
        sa.Column("enterprise_name", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "final_report_scope_members",
        sa.Column("enterprise_category", sa.String(length=120), nullable=True),
    )
    op.add_column(
        "final_report_scope_members",
        sa.Column("site_code", sa.String(length=80), nullable=True),
    )
    op.add_column(
        "final_report_scope_members",
        sa.Column("site_name", sa.String(length=160), nullable=True),
    )


def _backfill_snapshot_facts() -> None:
    # The target event/member tables are protected by immutable update triggers.
    # Disable only those named guards inside this transactional, access-exclusive
    # migration and restore them before adding the constraints.
    op.execute(
        "LOCK TABLE report_review_events, final_report_events, "
        "final_report_scope_members IN ACCESS EXCLUSIVE MODE"
    )
    op.execute(
        "ALTER TABLE report_review_events DISABLE TRIGGER trg_report_review_events_immutable"
    )
    op.execute("ALTER TABLE final_report_events DISABLE TRIGGER trg_final_report_events_immutable")
    op.execute(
        "ALTER TABLE final_report_scope_members "
        "DISABLE TRIGGER trg_final_report_scope_members_immutable"
    )
    op.execute(
        """
        UPDATE report_review_events AS event
        SET actor_display_name = account.display_name
        FROM accounts AS account
        WHERE event.actor_account_id = account.id
        """
    )
    op.execute(
        """
        UPDATE final_report_events AS event
        SET actor_display_name = account.display_name
        FROM accounts AS account
        WHERE event.actor_account_id = account.id
        """
    )
    op.execute(
        """
        UPDATE final_report_scope_members AS member
        SET enterprise_official_code = enterprise.official_code,
            enterprise_name = enterprise.name,
            enterprise_category = enterprise.category,
            site_code = site.site_code,
            site_name = site.name
        FROM enterprises AS enterprise, enterprise_sites AS site
        WHERE enterprise.id = member.enterprise_id
          AND enterprise.classification = member.classification
          AND site.id = member.site_id
          AND site.enterprise_id = member.enterprise_id
          AND site.classification = member.classification
        """
    )
    op.execute("ALTER TABLE report_review_events ENABLE TRIGGER trg_report_review_events_immutable")
    op.execute("ALTER TABLE final_report_events ENABLE TRIGGER trg_final_report_events_immutable")
    op.execute(
        "ALTER TABLE final_report_scope_members "
        "ENABLE TRIGGER trg_final_report_scope_members_immutable"
    )


def _enforce_snapshot_constraints() -> None:
    op.create_check_constraint(
        "ck_report_review_events_actor_snapshot",
        "report_review_events",
        "(actor_account_id IS NULL AND actor_display_name IS NULL) OR "
        "(actor_account_id IS NOT NULL AND actor_display_name IS NOT NULL "
        "AND length(trim(actor_display_name)) > 0)",
    )
    op.create_check_constraint(
        "ck_final_report_events_actor_snapshot",
        "final_report_events",
        "(actor_account_id IS NULL AND actor_display_name IS NULL) OR "
        "(actor_account_id IS NOT NULL AND actor_display_name IS NOT NULL "
        "AND length(trim(actor_display_name)) > 0)",
    )
    for column_name in (
        "enterprise_official_code",
        "enterprise_name",
        "site_code",
        "site_name",
    ):
        op.alter_column(
            "final_report_scope_members",
            column_name,
            existing_type=sa.String(),
            nullable=False,
        )
    op.create_check_constraint(
        "ck_final_report_scope_members_identity_snapshots",
        "final_report_scope_members",
        "length(trim(enterprise_official_code)) > 0 "
        "AND length(trim(enterprise_name)) > 0 "
        "AND length(trim(site_code)) > 0 "
        "AND length(trim(site_name)) > 0",
    )


def _create_read_indexes() -> None:
    op.create_index(
        "ix_reporting_obligations_period_classification_id",
        "reporting_obligations",
        ["reporting_period_id", "classification", "id"],
    )
    op.create_index(
        "ix_enterprise_reports_queue_state_current",
        "enterprise_reports",
        ["classification", "workflow_state", "current_revision_id", "id"],
    )
    op.create_index(
        "ix_report_revisions_queue_received",
        "report_revisions",
        ["classification", "received_at", "enterprise_report_id", "id"],
    )
    op.create_index(
        "ix_report_source_batches_revision_order",
        "report_source_batches",
        ["report_revision_id", "camera_id", "event_sequence_start", "id"],
    )
    current_version = sa.text("disposition = 'current'")
    op.create_index(
        "ix_final_report_versions_current_keyset",
        "final_report_versions",
        ["classification", "finalized_at", "report_finalization_id"],
        postgresql_where=current_version,
    )
    op.create_index(
        "ix_final_report_versions_current_scope_keyset",
        "final_report_versions",
        ["classification", "scope_type", "finalized_at", "report_finalization_id"],
        postgresql_where=current_version,
    )
    op.create_index(
        "ix_report_finalizations_period_current",
        "report_finalizations",
        ["classification", "reporting_period_id", "current_version_id", "id"],
    )
