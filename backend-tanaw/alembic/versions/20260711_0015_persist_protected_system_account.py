"""Persist protected system-account identity independently of environment variables.

Revision ID: 20260711_0015
Revises: 20260711_0014
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260711_0015"
down_revision: str | Sequence[str] | None = "20260711_0014"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "
        "is_protected_system_account BOOLEAN NOT NULL DEFAULT false"
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF to_regclass(current_schema() || '.system_configuration') IS NOT NULL THEN
                UPDATE accounts
                SET is_protected_system_account = true
                WHERE id IN (
                    SELECT jsonb_array_elements_text(values_json::jsonb -> 'accountIds')
                    FROM system_configuration
                    WHERE id = 'startup-bootstrap-v1'
                      AND jsonb_typeof(values_json::jsonb -> 'accountIds') = 'array'
                );
            END IF;
        END $$
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE accounts DROP COLUMN IF EXISTS is_protected_system_account")
