"""mock data provenance and final reports

Revision ID: 20260619_0008
Revises: 20260615_0007
Create Date: 2026-06-19 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260619_0008"
down_revision: str | Sequence[str] | None = "20260615_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("source_kind", sa.String(length=20), nullable=False, server_default="real"),
    )
    op.add_column("accounts", sa.Column("mock_run_id", sa.String(length=36), nullable=True))
    op.create_index("ix_accounts_mock_run_id", "accounts", ["mock_run_id"])

    op.add_column(
        "activity_logs",
        sa.Column("source_kind", sa.String(length=20), nullable=False, server_default="real"),
    )
    op.add_column("activity_logs", sa.Column("mock_run_id", sa.String(length=36), nullable=True))
    op.create_index("ix_activity_logs_mock_run_id", "activity_logs", ["mock_run_id"])

    op.add_column(
        "enterprise_telemetry_snapshots",
        sa.Column("source_kind", sa.String(length=20), nullable=False, server_default="real"),
    )
    op.add_column(
        "enterprise_telemetry_snapshots",
        sa.Column("mock_run_id", sa.String(length=36), nullable=True),
    )
    op.create_index(
        "ix_enterprise_telemetry_snapshots_mock_run_id",
        "enterprise_telemetry_snapshots",
        ["mock_run_id"],
    )

    op.add_column(
        "enterprise_report_submissions",
        sa.Column("source_kind", sa.String(length=20), nullable=False, server_default="real"),
    )
    op.add_column(
        "enterprise_report_submissions",
        sa.Column("mock_run_id", sa.String(length=36), nullable=True),
    )
    op.create_index(
        "ix_enterprise_report_submissions_mock_run_id",
        "enterprise_report_submissions",
        ["mock_run_id"],
    )

    op.create_table(
        "final_reports",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("report_code", sa.String(length=80), nullable=False),
        sa.Column("title", sa.String(length=160), nullable=False),
        sa.Column("period", sa.String(length=120), nullable=False),
        sa.Column(
            "generated_on",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("prepared_by", sa.String(length=120), nullable=False),
        sa.Column(
            "prepared_role",
            sa.String(length=120),
            nullable=False,
            server_default="Staff Processing Division",
        ),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="Draft"),
        sa.Column("total_entry", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_exit", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_unique", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("enterprise_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("source_kind", sa.String(length=20), nullable=False, server_default="real"),
        sa.Column("mock_run_id", sa.String(length=36), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_final_reports_report_code", "final_reports", ["report_code"], unique=True)
    op.create_index("ix_final_reports_period", "final_reports", ["period"])
    op.create_index("ix_final_reports_generated_on", "final_reports", ["generated_on"])
    op.create_index("ix_final_reports_mock_run_id", "final_reports", ["mock_run_id"])

    op.create_table(
        "final_report_sources",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("final_report_id", sa.String(length=36), nullable=False),
        sa.Column("intake_report_id", sa.String(length=36), nullable=False),
        sa.Column("enterprise_id", sa.String(length=120), nullable=False),
        sa.Column("enterprise", sa.String(length=120), nullable=False),
        sa.Column("code", sa.String(length=80), nullable=False),
        sa.Column("unique_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("entries", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("exits", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["final_report_id"], ["final_reports.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("final_report_id", "intake_report_id", name="uq_final_report_source"),
    )
    op.create_index(
        "ix_final_report_sources_final_report_id", "final_report_sources", ["final_report_id"]
    )
    op.create_index(
        "ix_final_report_sources_intake_report_id", "final_report_sources", ["intake_report_id"]
    )
    op.create_index(
        "ix_final_report_sources_enterprise_id", "final_report_sources", ["enterprise_id"]
    )

    op.create_table(
        "mock_data_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("scenario", sa.String(length=80), nullable=False),
        sa.Column("seed", sa.String(length=80), nullable=False),
        sa.Column("range_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("range_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column("target_account_id", sa.String(length=36), nullable=True),
        sa.Column("target_enterprise_id", sa.String(length=120), nullable=True),
        sa.Column("target_enterprise_name", sa.String(length=120), nullable=True),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="active"),
        sa.Column("generated_counts_json", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("mock_data_runs")

    op.drop_index("ix_final_report_sources_enterprise_id", table_name="final_report_sources")
    op.drop_index("ix_final_report_sources_intake_report_id", table_name="final_report_sources")
    op.drop_index("ix_final_report_sources_final_report_id", table_name="final_report_sources")
    op.drop_table("final_report_sources")

    op.drop_index("ix_final_reports_mock_run_id", table_name="final_reports")
    op.drop_index("ix_final_reports_generated_on", table_name="final_reports")
    op.drop_index("ix_final_reports_period", table_name="final_reports")
    op.drop_index("ix_final_reports_report_code", table_name="final_reports")
    op.drop_table("final_reports")

    op.drop_index(
        "ix_enterprise_report_submissions_mock_run_id", table_name="enterprise_report_submissions"
    )
    op.drop_column("enterprise_report_submissions", "mock_run_id")
    op.drop_column("enterprise_report_submissions", "source_kind")

    op.drop_index(
        "ix_enterprise_telemetry_snapshots_mock_run_id", table_name="enterprise_telemetry_snapshots"
    )
    op.drop_column("enterprise_telemetry_snapshots", "mock_run_id")
    op.drop_column("enterprise_telemetry_snapshots", "source_kind")

    op.drop_index("ix_activity_logs_mock_run_id", table_name="activity_logs")
    op.drop_column("activity_logs", "mock_run_id")
    op.drop_column("activity_logs", "source_kind")

    op.drop_index("ix_accounts_mock_run_id", table_name="accounts")
    op.drop_column("accounts", "mock_run_id")
    op.drop_column("accounts", "source_kind")
