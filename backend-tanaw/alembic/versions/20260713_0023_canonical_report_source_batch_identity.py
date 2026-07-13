"""Use the edge source-batch UUID as the canonical report lineage identity.

Revision ID: 20260713_0023
Revises: 20260713_0022

The additive reporting foundation initially stored both a generated row UUID and
the edge batch UUID. A source batch is an immutable, globally unique lineage
claim, so retaining two identities weakens reuse protection and complicates the
ERD. This migration keeps the authenticated edge UUID as the table primary key
and removes the redundant generated identity and compatibility column name.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260713_0023"
down_revision: str | Sequence[str] | None = "20260713_0022"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE report_source_batches
            DROP CONSTRAINT uq_report_source_batches_revision_key,
            DROP CONSTRAINT report_source_batches_pkey,
            DROP COLUMN id,
            ALTER COLUMN batch_key TYPE UUID USING batch_key::uuid
        """
    )
    op.execute("ALTER TABLE report_source_batches RENAME COLUMN batch_key TO id")
    op.execute(
        """
        ALTER TABLE report_source_batches
            ADD CONSTRAINT report_source_batches_pkey PRIMARY KEY (id)
        """
    )


def downgrade() -> None:
    raise RuntimeError(
        "Downgrade is intentionally unsupported for the canonical report source-batch "
        "identity migration. Restore the verified pre-cutover backup and matching build."
    )
