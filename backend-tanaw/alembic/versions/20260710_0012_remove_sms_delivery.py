"""Remove legacy SMS delivery support.

Revision ID: 20260710_0012
Revises: 20260710_0011
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260710_0012"
down_revision: str | Sequence[str] | None = "20260710_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'dev_deliveries'
                  AND column_name = 'channel'
            ) THEN
                DELETE FROM dev_deliveries WHERE channel::text = 'SMS';
                ALTER TABLE dev_deliveries DROP COLUMN channel;
            END IF;
        END $$
        """
    )
    postgresql.ENUM(name="delivery_channel").drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    delivery_channel = postgresql.ENUM("EMAIL", "SMS", name="delivery_channel", create_type=False)
    delivery_channel.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "dev_deliveries",
        sa.Column(
            "channel",
            delivery_channel,
            nullable=False,
            server_default="EMAIL",
        ),
    )
    op.alter_column("dev_deliveries", "channel", server_default=None)
