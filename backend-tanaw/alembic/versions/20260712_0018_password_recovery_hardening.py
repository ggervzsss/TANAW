"""Add durable password-recovery abuse controls and audit timestamps.

Revision ID: 20260712_0018
Revises: 20260711_0017

Downgrading preserves every pre-0018 account/challenge/outbox field, but drops
the transient rate buckets plus the new attempt/audit timestamps. The legacy
``used`` and ``code_consumed`` flags continue to keep invalid challenges closed.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260712_0018"
down_revision: str | Sequence[str] | None = "20260711_0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    challenge_columns = (
        "ALTER TABLE password_reset_challenges ADD COLUMN reset_attempts INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE password_reset_challenges ADD COLUMN verified_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE password_reset_challenges ADD COLUMN used_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE password_reset_challenges ADD COLUMN invalidated_at TIMESTAMP WITH TIME ZONE",
    )
    for statement in challenge_columns:
        op.execute(statement)
    op.execute(
        "ALTER TABLE password_reset_challenges ADD CONSTRAINT "
        "ck_password_reset_challenge_attempts CHECK (attempts >= 0)"
    )
    op.execute(
        "ALTER TABLE password_reset_challenges ADD CONSTRAINT "
        "ck_password_reset_challenge_reset_attempts CHECK (reset_attempts >= 0)"
    )
    op.execute(
        "CREATE INDEX ix_password_reset_challenges_invalidated_at "
        "ON password_reset_challenges (invalidated_at)"
    )
    op.execute(
        "CREATE INDEX ix_password_reset_challenges_email_active_created "
        "ON password_reset_challenges (email, used, created_at)"
    )

    op.execute(
        """
        CREATE TABLE password_reset_rate_limit_buckets (
            bucket_key VARCHAR(120) PRIMARY KEY,
            scope VARCHAR(20) NOT NULL,
            window_started_at TIMESTAMP WITH TIME ZONE NOT NULL,
            request_count INTEGER NOT NULL,
            blocked_at TIMESTAMP WITH TIME ZONE,
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT ck_password_reset_rate_count CHECK (request_count >= 0),
            CONSTRAINT ck_password_reset_rate_scope
                CHECK (scope IN ('global', 'ip', 'identifier'))
        )
        """
    )
    op.execute(
        "CREATE INDEX ix_password_reset_rate_limit_buckets_scope "
        "ON password_reset_rate_limit_buckets (scope)"
    )
    op.execute(
        "CREATE INDEX ix_password_reset_rate_limit_buckets_updated_at "
        "ON password_reset_rate_limit_buckets (updated_at)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE password_reset_rate_limit_buckets")
    op.execute("DROP INDEX ix_password_reset_challenges_email_active_created")
    op.execute("DROP INDEX ix_password_reset_challenges_invalidated_at")
    op.execute(
        "ALTER TABLE password_reset_challenges DROP CONSTRAINT "
        "ck_password_reset_challenge_reset_attempts"
    )
    op.execute(
        "ALTER TABLE password_reset_challenges DROP CONSTRAINT ck_password_reset_challenge_attempts"
    )
    op.execute("ALTER TABLE password_reset_challenges DROP COLUMN invalidated_at")
    op.execute("ALTER TABLE password_reset_challenges DROP COLUMN used_at")
    op.execute("ALTER TABLE password_reset_challenges DROP COLUMN verified_at")
    op.execute("ALTER TABLE password_reset_challenges DROP COLUMN reset_attempts")
