"""Add auditable final-report artifact lifecycle and controlled repair.

Revision ID: 20260714_0029
Revises: 20260714_0028

Artifact generation is an authoritative asynchronous workflow.  This revision
records every state transition against the immutable final-report version and
allows a verified ``ready`` row to enter a bounded repair state if its durable
object is later missing or corrupt.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260714_0029"
down_revision: str | Sequence[str] | None = "20260714_0028"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE final_report_events ADD COLUMN final_report_artifact_id UUID NULL")
    op.execute(
        "ALTER TABLE final_report_artifacts "
        "ADD CONSTRAINT uq_final_report_artifacts_event_scope "
        "UNIQUE (id, final_report_version_id, classification)"
    )
    op.execute(
        "ALTER TABLE final_report_events "
        "ADD CONSTRAINT fk_final_report_events_artifact_scope "
        "FOREIGN KEY (final_report_artifact_id, final_report_version_id, classification) "
        "REFERENCES final_report_artifacts(id, final_report_version_id, classification) "
        "ON DELETE RESTRICT"
    )
    op.execute("ALTER TABLE final_report_events DROP CONSTRAINT ck_final_report_events_type")
    op.execute(
        "ALTER TABLE final_report_events "
        "ADD CONSTRAINT ck_final_report_events_type CHECK (event_type IN ("
        "'version_finalized', 'legacy_final_imported', 'artifact_ready', "
        "'artifact_failed', 'artifact_retry_scheduled', 'artifact_repair_requested'))"
    )
    op.execute("ALTER TABLE final_report_events DROP CONSTRAINT ck_final_report_events_versions")
    op.execute(
        "ALTER TABLE final_report_events "
        "ADD CONSTRAINT ck_final_report_events_versions CHECK ("
        "(event_type IN ('version_finalized', 'legacy_final_imported') "
        "AND final_report_artifact_id IS NULL AND expected_version >= 0 "
        "AND resulting_version > expected_version) OR "
        "(event_type IN ('artifact_ready', 'artifact_failed', "
        "'artifact_retry_scheduled', 'artifact_repair_requested') "
        "AND final_report_artifact_id IS NOT NULL "
        "AND expected_version = resulting_version AND resulting_version >= 1))"
    )
    op.execute(
        "ALTER TABLE final_report_artifacts DROP CONSTRAINT ck_final_report_artifacts_status"
    )
    op.execute(
        "ALTER TABLE final_report_artifacts "
        "ADD CONSTRAINT ck_final_report_artifacts_status "
        "CHECK (status IN ('pending', 'repairing', 'ready', 'failed'))"
    )


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260714_0029 is intentionally irreversible because artifact "
        "lifecycle events are durable audit evidence. Restore the verified "
        "pre-cutover backup and matching application build instead."
    )
