"""operational desktop sync tables

Revision ID: 20260615_0007
Revises: 20260529_0006
Create Date: 2026-06-15 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260615_0007"
down_revision: str | Sequence[str] | None = "20260529_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "enterprise_telemetry_snapshots",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("enterprise_account_id", sa.String(length=36), nullable=False),
        sa.Column("enterprise_id", sa.String(length=120), nullable=False),
        sa.Column("enterprise_name", sa.String(length=120), nullable=False),
        sa.Column("camera_id", sa.String(length=80), nullable=True),
        sa.Column("camera_name", sa.String(length=120), nullable=True),
        sa.Column("captured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("entries", sa.Integer(), nullable=False),
        sa.Column("exits", sa.Integer(), nullable=False),
        sa.Column("current_occupancy", sa.Integer(), nullable=False),
        sa.Column("peak_occupancy", sa.Integer(), nullable=False),
        sa.Column("unique_count", sa.Integer(), nullable=False),
        sa.Column("confirmed_unique_count", sa.Integer(), nullable=False),
        sa.Column("degraded_unique_count", sa.Integer(), nullable=False),
        sa.Column("total_events", sa.Integer(), nullable=False),
        sa.Column("unsubmitted_events", sa.Integer(), nullable=False),
        sa.Column("unsynced_events", sa.Integer(), nullable=False),
        sa.Column("running", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("analytics_fps", sa.Float(), nullable=True),
        sa.Column("payload_json", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_enterprise_telemetry_snapshots_captured_at",
        "enterprise_telemetry_snapshots",
        ["captured_at"],
    )
    op.create_index(
        "ix_enterprise_telemetry_snapshots_enterprise_account_id",
        "enterprise_telemetry_snapshots",
        ["enterprise_account_id"],
    )
    op.create_index(
        "ix_enterprise_telemetry_snapshots_enterprise_id",
        "enterprise_telemetry_snapshots",
        ["enterprise_id"],
    )
    op.create_index(
        "ix_enterprise_telemetry_snapshots_received_at",
        "enterprise_telemetry_snapshots",
        ["received_at"],
    )

    op.create_table(
        "enterprise_report_submissions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("report_id", sa.String(length=80), nullable=False),
        sa.Column("enterprise_account_id", sa.String(length=36), nullable=False),
        sa.Column("enterprise_id", sa.String(length=120), nullable=False),
        sa.Column("enterprise_name", sa.String(length=120), nullable=False),
        sa.Column("category", sa.String(length=120), nullable=True),
        sa.Column("barangay", sa.String(length=120), nullable=True),
        sa.Column("period", sa.String(length=120), nullable=False),
        sa.Column("month", sa.String(length=40), nullable=False),
        sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("entries", sa.Integer(), nullable=False),
        sa.Column("exits", sa.Integer(), nullable=False),
        sa.Column("peak_occupancy", sa.Integer(), nullable=False),
        sa.Column("unique_count", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("review_status", sa.String(length=40), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("sync_status", sa.String(length=60), nullable=True),
        sa.Column("payload_json", sa.Text(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("enterprise_id", "report_id", name="uq_enterprise_report_submission"),
    )
    op.create_index(
        "ix_enterprise_report_submissions_enterprise_account_id",
        "enterprise_report_submissions",
        ["enterprise_account_id"],
    )
    op.create_index(
        "ix_enterprise_report_submissions_enterprise_id",
        "enterprise_report_submissions",
        ["enterprise_id"],
    )
    op.create_index(
        "ix_enterprise_report_submissions_month", "enterprise_report_submissions", ["month"]
    )
    op.create_index(
        "ix_enterprise_report_submissions_period", "enterprise_report_submissions", ["period"]
    )
    op.create_index(
        "ix_enterprise_report_submissions_received_at",
        "enterprise_report_submissions",
        ["received_at"],
    )
    op.create_index(
        "ix_enterprise_report_submissions_report_id", "enterprise_report_submissions", ["report_id"]
    )
    op.create_index(
        "ix_enterprise_report_submissions_submitted_at",
        "enterprise_report_submissions",
        ["submitted_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_enterprise_report_submissions_submitted_at", table_name="enterprise_report_submissions"
    )
    op.drop_index(
        "ix_enterprise_report_submissions_report_id", table_name="enterprise_report_submissions"
    )
    op.drop_index(
        "ix_enterprise_report_submissions_received_at", table_name="enterprise_report_submissions"
    )
    op.drop_index(
        "ix_enterprise_report_submissions_period", table_name="enterprise_report_submissions"
    )
    op.drop_index(
        "ix_enterprise_report_submissions_month", table_name="enterprise_report_submissions"
    )
    op.drop_index(
        "ix_enterprise_report_submissions_enterprise_id", table_name="enterprise_report_submissions"
    )
    op.drop_index(
        "ix_enterprise_report_submissions_enterprise_account_id",
        table_name="enterprise_report_submissions",
    )
    op.drop_table("enterprise_report_submissions")

    op.drop_index(
        "ix_enterprise_telemetry_snapshots_received_at", table_name="enterprise_telemetry_snapshots"
    )
    op.drop_index(
        "ix_enterprise_telemetry_snapshots_enterprise_id",
        table_name="enterprise_telemetry_snapshots",
    )
    op.drop_index(
        "ix_enterprise_telemetry_snapshots_enterprise_account_id",
        table_name="enterprise_telemetry_snapshots",
    )
    op.drop_index(
        "ix_enterprise_telemetry_snapshots_captured_at", table_name="enterprise_telemetry_snapshots"
    )
    op.drop_table("enterprise_telemetry_snapshots")
