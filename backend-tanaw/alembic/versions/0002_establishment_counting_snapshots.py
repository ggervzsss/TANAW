"""Upgrade existing databases for establishment counting snapshots.

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

# 0001 was deployed before it was edited for counting snapshots. Preserve the
# original file and support both known versions without accepting arbitrary
# schema identities or deleting application data.
ORIGINAL_BASELINE_FINGERPRINT = "bac09dee66a980eb263b8f297d6e2c81a80596b33746d259b8a7c4aa02403d01"
EDITED_BASELINE_FINGERPRINT = "522e8d6d652fc891ba5a75a2c78ec3965bd7c6b96cc53c386fd920fdb402d37b"

NULLABLE_MEASUREMENTS = {
    "enterprise_telemetry_snapshots": (
        "entries",
        "exits",
        "current_occupancy",
        "peak_occupancy",
        "unique_count",
    ),
    "enterprise_report_submissions": ("entries", "exits", "peak_occupancy"),
    "final_reports": ("total_entry", "total_exit"),
    "final_report_sources": ("entries", "exits"),
}


def upgrade() -> None:
    op.execute(
        f"""DO $$
        DECLARE fingerprint text;
        BEGIN
            SELECT schema_fingerprint INTO fingerprint
            FROM tanaw_schema_identity WHERE singleton_id = 1;
            IF fingerprint IS NULL OR fingerprint NOT IN (
                '{ORIGINAL_BASELINE_FINGERPRINT}', '{EDITED_BASELINE_FINGERPRINT}'
            ) THEN
                RAISE EXCEPTION 'Unrecognized TANAW baseline; review the schema before upgrading';
            END IF;
        END $$"""
    )
    for table, columns in NULLABLE_MEASUREMENTS.items():
        for column in columns:
            op.alter_column(table, column, existing_type=sa.Integer(), nullable=True)

    # Databases initialized using the briefly edited 0001 already have this
    # column. Upgrading them must preserve their saved counting evidence.
    op.execute("ALTER TABLE final_report_sources ADD COLUMN IF NOT EXISTS counting_json JSONB")
    identity = sa.table(
        "tanaw_schema_identity",
        sa.column("singleton_id", sa.Integer()),
        sa.column("schema_fingerprint", sa.String(64)),
    )
    op.execute(
        identity.update()
        .where(identity.c.singleton_id == 1)
        .values(schema_fingerprint=ORIGINAL_BASELINE_FINGERPRINT)
    )


def downgrade() -> None:
    # PostgreSQL rejects this downgrade if any measurements are unavailable;
    # do not invent zero counts to make legacy NOT NULL constraints fit.
    for table, columns in NULLABLE_MEASUREMENTS.items():
        for column in columns:
            op.alter_column(table, column, existing_type=sa.Integer(), nullable=False)
    op.drop_column("final_report_sources", "counting_json")
