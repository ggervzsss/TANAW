"""Add the transactional outbound-email outbox.

Revision ID: 20260711_0017
Revises: 20260711_0016
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260711_0017"
down_revision: str | Sequence[str] | None = "20260711_0016"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TABLE account_activation_tokens ALTER COLUMN id TYPE VARCHAR(64)")
    op.execute("ALTER TABLE password_reset_challenges ALTER COLUMN id TYPE VARCHAR(64)")
    op.execute("ALTER TYPE delivery_status ADD VALUE IF NOT EXISTS 'ACCEPTED'")
    op.execute(
        """
        CREATE TABLE email_outbox (
            id VARCHAR(36) PRIMARY KEY,
            account_id VARCHAR(36) NOT NULL,
            purpose VARCHAR(60) NOT NULL,
            source_id VARCHAR(120) NOT NULL,
            recipient VARCHAR(255) NOT NULL,
            sender VARCHAR(255) NOT NULL,
            template_name VARCHAR(60) NOT NULL,
            template_version VARCHAR(20) NOT NULL,
            secret_version VARCHAR(20) NOT NULL,
            template_payload_json TEXT NOT NULL,
            tags_json TEXT,
            idempotency_key VARCHAR(256) NOT NULL,
            provider VARCHAR(40) NOT NULL,
            status VARCHAR(30) NOT NULL,
            attempt_count INTEGER NOT NULL,
            max_attempts INTEGER NOT NULL,
            next_attempt_at TIMESTAMP WITH TIME ZONE NOT NULL,
            valid_until TIMESTAMP WITH TIME ZONE,
            lock_token VARCHAR(36),
            locked_at TIMESTAMP WITH TIME ZONE,
            lock_expires_at TIMESTAMP WITH TIME ZONE,
            provider_message_id VARCHAR(120),
            provider_payload_hash VARCHAR(64),
            first_provider_attempt_at TIMESTAMP WITH TIME ZONE,
            last_provider_attempt_at TIMESTAMP WITH TIME ZONE,
            outcome_uncertain BOOLEAN NOT NULL,
            manual_retry_count INTEGER NOT NULL,
            last_error_code VARCHAR(80),
            last_error_message TEXT,
            accepted_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT uq_email_outbox_logical_message UNIQUE (purpose, source_id, recipient),
            CONSTRAINT ck_email_outbox_attempt_count CHECK (attempt_count >= 0),
            CONSTRAINT ck_email_outbox_max_attempts CHECK (max_attempts >= 1),
            CONSTRAINT ck_email_outbox_manual_retry_count CHECK (manual_retry_count >= 0),
            CONSTRAINT ck_email_outbox_lease_state CHECK (
                (status = 'processing' AND lock_token IS NOT NULL AND lock_expires_at IS NOT NULL)
                OR (status <> 'processing' AND lock_token IS NULL AND lock_expires_at IS NULL)
            )
        )
        """
    )
    indexes = (
        "CREATE INDEX ix_email_outbox_account_id ON email_outbox (account_id)",
        "CREATE INDEX ix_email_outbox_purpose ON email_outbox (purpose)",
        "CREATE INDEX ix_email_outbox_source_id ON email_outbox (source_id)",
        "CREATE INDEX ix_email_outbox_status ON email_outbox (status)",
        "CREATE INDEX ix_email_outbox_next_attempt_at ON email_outbox (next_attempt_at)",
        "CREATE INDEX ix_email_outbox_lock_expires_at ON email_outbox (lock_expires_at)",
        "CREATE UNIQUE INDEX ix_email_outbox_provider_message_id ON email_outbox (provider_message_id)",
        "CREATE INDEX ix_email_outbox_created_at ON email_outbox (created_at)",
        "CREATE INDEX ix_email_outbox_status_next_attempt ON email_outbox (status, next_attempt_at)",
        "CREATE INDEX ix_email_outbox_purpose_source ON email_outbox (purpose, source_id)",
        "CREATE UNIQUE INDEX ix_email_outbox_idempotency_key ON email_outbox (idempotency_key)",
    )
    for statement in indexes:
        op.execute(statement)
    op.execute(
        """
        CREATE TABLE email_delivery_attempts (
            id VARCHAR(36) PRIMARY KEY,
            outbox_id VARCHAR(36) NOT NULL REFERENCES email_outbox(id) ON DELETE CASCADE,
            attempt_number INTEGER NOT NULL,
            provider VARCHAR(40) NOT NULL,
            status VARCHAR(30) NOT NULL,
            provider_message_id VARCHAR(120),
            error_code VARCHAR(80),
            error_message TEXT,
            outcome_uncertain BOOLEAN NOT NULL,
            started_at TIMESTAMP WITH TIME ZONE NOT NULL,
            finished_at TIMESTAMP WITH TIME ZONE NOT NULL,
            CONSTRAINT uq_email_delivery_attempt UNIQUE (outbox_id, attempt_number)
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_email_delivery_attempts_outbox_id ON email_delivery_attempts (outbox_id)"
    )
    op.execute("CREATE INDEX ix_email_delivery_attempts_status ON email_delivery_attempts (status)")


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260711_0017 is intentionally irreversible because dropping the email "
        "outbox can lose queued or uncertain deliveries. Restore a verified backup or deploy "
        "a forward fix instead."
    )
