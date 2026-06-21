"""activity logs

Revision ID: 20260525_0005
Revises: 20260525_0004
Create Date: 2026-05-25
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260525_0005"
down_revision: str | Sequence[str] | None = "20260525_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "activity_logs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column(
            "timestamp", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("category", sa.String(length=40), nullable=False),
        sa.Column("severity", sa.String(length=20), nullable=False),
        sa.Column("actor", sa.String(length=120), nullable=False),
        sa.Column("actor_role", sa.String(length=40), nullable=False),
        sa.Column("action", sa.String(length=120), nullable=False),
        sa.Column("target", sa.String(length=255), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("source_id", sa.String(length=120), nullable=True),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_activity_logs_actor_role"), "activity_logs", ["actor_role"], unique=False
    )
    op.create_index(op.f("ix_activity_logs_category"), "activity_logs", ["category"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_activity_logs_category"), table_name="activity_logs")
    op.drop_index(op.f("ix_activity_logs_actor_role"), table_name="activity_logs")
    op.drop_table("activity_logs")
