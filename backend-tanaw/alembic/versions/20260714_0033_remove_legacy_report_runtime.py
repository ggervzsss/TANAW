"""Remove superseded central report and telemetry storage after reconciliation.

Revision ID: 20260714_0033
Revises: 20260714_0032

This is the coordinated target-only cutover.  It deliberately fails closed when
any legacy source is unresolved or lacks an auditable target representation.
Recovery is the complete external pre-cutover backup, never retained live tables.
"""

from collections.abc import Sequence
from uuid import UUID, uuid5

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from alembic import op

revision: str = "20260714_0033"
down_revision: str | Sequence[str] | None = "20260714_0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TELEMETRY_NAMESPACE = UUID("a09bc021-3717-42c2-b375-6625413650f5")
_FINAL_NAMESPACE = UUID("5e87e6cc-d6b5-4e59-a5cc-c18207663df4")


def upgrade() -> None:
    connection = op.get_bind()
    _require_resolved_exceptions(connection)
    _require_report_reconciliation(connection)
    _require_telemetry_reconciliation(connection)
    _require_final_report_reconciliation(connection)

    op.drop_table("final_report_sources")
    op.drop_table("final_reports")
    op.drop_table("enterprise_report_submissions")
    op.drop_table("enterprise_telemetry_snapshots")


def _require_resolved_exceptions(connection: Connection) -> None:
    open_report_sources = int(
        connection.scalar(
            sa.text(
                """
                SELECT count(*)
                FROM report_migration_exceptions
                WHERE status = 'open'
                  AND source_table IN ('enterprise_report_submissions', 'final_reports')
                """
            )
        )
        or 0
    )
    open_telemetry_sources = int(
        connection.scalar(
            sa.text(
                """
                SELECT count(*)
                FROM telemetry_migration_exceptions
                WHERE status = 'open'
                  AND source_table = 'enterprise_telemetry_snapshots'
                """
            )
        )
        or 0
    )
    if open_report_sources or open_telemetry_sources:
        raise RuntimeError(
            "Target-only cutover blocked: resolve or waive every legacy migration "
            f"exception first (report={open_report_sources}, "
            f"telemetry={open_telemetry_sources})."
        )


def _require_report_reconciliation(connection: Connection) -> None:
    missing = int(
        connection.scalar(
            sa.text(
                """
                SELECT count(*)
                FROM enterprise_report_submissions AS source
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM report_revisions AS revision
                    WHERE revision.local_revision_id = 'legacy:' || source.id
                )
                  AND NOT EXISTS (
                    SELECT 1
                    FROM report_migration_exceptions AS exception
                    WHERE exception.source_table = 'enterprise_report_submissions'
                      AND exception.source_row_id = source.id
                      AND exception.status IN ('resolved', 'waived')
                )
                """
            )
        )
        or 0
    )
    if missing:
        raise RuntimeError(
            "Target-only cutover blocked: "
            f"{missing} legacy report submission(s) have no target revision or resolution."
        )


def _require_telemetry_reconciliation(connection: Connection) -> None:
    source_ids = list(connection.scalars(sa.text("SELECT id FROM enterprise_telemetry_snapshots")))
    for source_id_value in source_ids:
        source_id = str(source_id_value)
        observation_id = str(
            uuid5(
                _TELEMETRY_NAMESPACE,
                f"tanaw:telemetry-observation:{source_id}",
            )
        )
        represented = bool(
            connection.scalar(
                sa.text("SELECT EXISTS (SELECT 1 FROM telemetry_observations WHERE id = :id)"),
                {"id": observation_id},
            )
        )
        resolved = bool(
            connection.scalar(
                sa.text(
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM telemetry_migration_exceptions
                        WHERE source_table = 'enterprise_telemetry_snapshots'
                          AND source_row_id = :source_id
                          AND status IN ('resolved', 'waived')
                    )
                    """
                ),
                {"source_id": source_id},
            )
        )
        if not represented and not resolved:
            raise RuntimeError(
                "Target-only cutover blocked: legacy telemetry snapshot "
                f"{source_id!r} has no target observation or resolution."
            )


def _require_final_report_reconciliation(connection: Connection) -> None:
    source_ids = list(connection.scalars(sa.text("SELECT id FROM final_reports")))
    for source_id_value in source_ids:
        source_id = str(source_id_value)
        finalization_id = str(uuid5(_FINAL_NAMESPACE, f"finalization:{source_id}"))
        represented = bool(
            connection.scalar(
                sa.text("SELECT EXISTS (SELECT 1 FROM report_finalizations WHERE id = :id)"),
                {"id": finalization_id},
            )
        )
        resolved = bool(
            connection.scalar(
                sa.text(
                    """
                    SELECT EXISTS (
                        SELECT 1
                        FROM report_migration_exceptions
                        WHERE source_table = 'final_reports'
                          AND source_row_id = :source_id
                          AND status IN ('resolved', 'waived')
                    )
                    """
                ),
                {"source_id": source_id},
            )
        )
        if not represented and not resolved:
            raise RuntimeError(
                "Target-only cutover blocked: legacy final report "
                f"{source_id!r} has no immutable finalization or resolution."
            )


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260714_0033 permanently removes superseded live tables. "
        "Restore the verified external pre-cutover backup and matching application "
        "build instead."
    )
