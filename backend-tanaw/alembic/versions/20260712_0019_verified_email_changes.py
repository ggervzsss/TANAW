"""Add verified account-email ownership changes.

Revision ID: 20260712_0019
Revises: 20260712_0018
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260712_0019"
down_revision: str | Sequence[str] | None = "20260712_0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE account_email_change_requests (
            id VARCHAR(64) PRIMARY KEY,
            account_id VARCHAR(36) NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            old_email VARCHAR(255) NOT NULL,
            requested_email VARCHAR(255) NOT NULL,
            token_hash VARCHAR(64),
            status VARCHAR(30) NOT NULL,
            expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
            requested_by_account_id VARCHAR(36),
            requested_by_name VARCHAR(120) NOT NULL,
            requested_by_role VARCHAR(40) NOT NULL,
            verified_at TIMESTAMP WITH TIME ZONE,
            resolved_at TIMESTAMP WITH TIME ZONE,
            resolved_by_account_id VARCHAR(36),
            resolved_by_name VARCHAR(120),
            invalidated_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT ck_account_email_change_status CHECK (
                status IN ('pending_verification', 'verified', 'approved', 'rejected',
                           'cancelled', 'replaced', 'expired')
            )
        )
        """
    )
    indexes = (
        "CREATE INDEX ix_account_email_change_requests_account_id ON account_email_change_requests (account_id)",
        "CREATE INDEX ix_account_email_change_requests_requested_email ON account_email_change_requests (requested_email)",
        "CREATE UNIQUE INDEX ix_account_email_change_requests_token_hash ON account_email_change_requests (token_hash)",
        "CREATE INDEX ix_account_email_change_requests_status ON account_email_change_requests (status)",
        "CREATE INDEX ix_account_email_change_requests_expires_at ON account_email_change_requests (expires_at)",
        "CREATE INDEX ix_account_email_change_requests_invalidated_at ON account_email_change_requests (invalidated_at)",
        "CREATE UNIQUE INDEX uq_account_email_change_active_account ON account_email_change_requests (account_id) WHERE status IN ('pending_verification', 'verified')",
        "CREATE UNIQUE INDEX uq_account_email_change_active_email ON account_email_change_requests (requested_email) WHERE status IN ('pending_verification', 'verified')",
    )
    for statement in indexes:
        op.execute(statement)

    # The prior preference-based request was informational only and must not remain
    # approvable after verified ownership becomes authoritative.
    op.execute(
        """
        UPDATE email_outbox
        SET status = 'cancelled',
            lock_token = NULL,
            locked_at = NULL,
            lock_expires_at = NULL,
            last_error_code = 'legacy_email_change_replaced',
            last_error_message = 'Replaced by the verified account-email ownership workflow.',
            updated_at = now()
        WHERE template_name = 'business_email_change'
          AND status IN (
              'queued', 'processing', 'retry_scheduled', 'terminal_failed',
              'reconciliation_required'
          )
        """
    )
    op.execute(
        """
        DO $$
        DECLARE
            account_row RECORD;
            cleaned_preferences JSONB;
        BEGIN
            FOR account_row IN
                SELECT id, preferences_json
                FROM accounts
                WHERE preferences_json IS NOT NULL
            LOOP
                BEGIN
                    cleaned_preferences :=
                        account_row.preferences_json::jsonb - 'pendingBusinessEmailChange';
                    UPDATE accounts
                    SET preferences_json = NULLIF(cleaned_preferences::text, '{}')
                    WHERE id = account_row.id;
                EXCEPTION WHEN invalid_text_representation THEN
                    NULL;
                END;
            END LOOP;
        END $$
        """
    )


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260712_0019 is intentionally irreversible because dropping verified "
        "email-change requests can lose pending ownership proofs and account-recovery audit "
        "state. Restore a verified backup or deploy a forward fix instead."
    )
