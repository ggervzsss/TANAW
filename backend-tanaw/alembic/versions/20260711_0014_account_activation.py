"""Replace temporary-password onboarding with account activation tokens.

Revision ID: 20260711_0014
Revises: 20260710_0013
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260711_0014"
down_revision: str | Sequence[str] | None = "20260710_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # TANAW's startup compatibility DDL may run before Alembic in existing
    # deployments, so every operation is safe to replay against that schema.
    op.execute(
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP WITH TIME ZONE"
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'accounts'
                  AND column_name = 'must_change_password'
            ) THEN
                UPDATE accounts
                SET activated_at = COALESCE(password_changed_at, created_at, now())
                WHERE must_change_password = false AND activated_at IS NULL;

                UPDATE accounts
                SET token_invalid_before = now()
                WHERE must_change_password = true;
            END IF;
        END $$
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS account_activation_tokens (
            id VARCHAR(36) PRIMARY KEY,
            account_id VARCHAR(36) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            token_hash VARCHAR(64) NOT NULL,
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            consumed_at TIMESTAMP WITH TIME ZONE,
            invalidated_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_account_activation_tokens_account_id "
        "ON account_activation_tokens (account_id)"
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_account_activation_tokens_token_hash "
        "ON account_activation_tokens (token_hash)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_account_activation_tokens_expires_at "
        "ON account_activation_tokens (expires_at)"
    )
    op.execute("ALTER TABLE accounts DROP COLUMN IF EXISTS temporary_password_expires_at")
    op.execute("ALTER TABLE accounts DROP COLUMN IF EXISTS temporary_password_created_at")
    op.execute("ALTER TABLE accounts DROP COLUMN IF EXISTS must_change_password")


def downgrade() -> None:
    op.execute(
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "
        "must_change_password BOOLEAN NOT NULL DEFAULT false"
    )
    op.execute(
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "
        "temporary_password_created_at TIMESTAMP WITH TIME ZONE"
    )
    op.execute(
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS "
        "temporary_password_expires_at TIMESTAMP WITH TIME ZONE"
    )
    op.execute(
        """
        UPDATE accounts
        SET must_change_password = true,
            temporary_password_created_at = now(),
            temporary_password_expires_at = now()
        WHERE activated_at IS NULL
        """
    )

    op.execute("DROP INDEX IF EXISTS ix_account_activation_tokens_expires_at")
    op.execute("DROP INDEX IF EXISTS ix_account_activation_tokens_token_hash")
    op.execute("DROP INDEX IF EXISTS ix_account_activation_tokens_account_id")
    op.execute("DROP TABLE IF EXISTS account_activation_tokens")
    op.execute("ALTER TABLE accounts DROP COLUMN IF EXISTS activated_at")
