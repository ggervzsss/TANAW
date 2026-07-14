"""Convert retained structural identities to native PostgreSQL UUIDs.

Revision ID: 20260714_0035
Revises: 20260714_0034

Opaque security tokens, provider identifiers, business codes, rate-limit keys,
and source identifiers intentionally remain strings. Primary keys and actual
relationships are converted together and receive explicit foreign keys.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.engine import Connection

from alembic import op

revision: str = "20260714_0035"
down_revision: str | Sequence[str] | None = "20260714_0034"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_EXISTING_FOREIGN_KEYS = (
    ("account_activation_tokens", "account_activation_tokens_account_id_fkey"),
    ("account_assets", "account_assets_account_id_fkey"),
    ("account_email_change_requests", "account_email_change_requests_account_id_fkey"),
    ("account_preferences", "account_preferences_account_id_fkey"),
    (
        "account_profile_change_requests",
        "account_profile_change_requests_account_id_fkey",
    ),
    (
        "account_profile_change_requests",
        "account_profile_change_requests_resolved_by_account_id_fkey",
    ),
    ("domain_events", "domain_events_actor_account_id_fkey"),
    ("email_delivery_attempts", "email_delivery_attempts_outbox_id_fkey"),
    ("enterprise_memberships", "enterprise_memberships_account_id_fkey"),
    ("enterprises", "fk_enterprises_simulation_run_id"),
    ("final_report_artifacts", "final_report_artifacts_generated_by_account_id_fkey"),
    ("final_report_events", "final_report_events_actor_account_id_fkey"),
    ("final_report_versions", "final_report_versions_prepared_by_account_id_fkey"),
    ("mock_data_run_accounts", "mock_data_run_accounts_account_id_fkey"),
    ("mock_data_run_accounts", "mock_data_run_accounts_run_id_fkey"),
    ("report_finalizations", "report_finalizations_created_by_account_id_fkey"),
    ("report_review_events", "report_review_events_actor_account_id_fkey"),
    ("report_revisions", "report_revisions_submitted_by_account_id_fkey"),
    ("site_sync_alert_states", "site_sync_alert_states_operational_alert_id_fkey"),
    ("support_attachments", "support_attachments_ticket_id_fkey"),
    ("support_ticket_messages", "support_ticket_messages_ticket_id_fkey"),
)

_UUID_COLUMNS = (
    ("accounts", "id", 36),
    ("account_activation_tokens", "account_id", 36),
    ("account_assets", "account_id", 36),
    ("account_email_change_requests", "account_id", 36),
    ("account_email_change_requests", "requested_by_account_id", 36),
    ("account_email_change_requests", "resolved_by_account_id", 36),
    ("account_preferences", "account_id", 36),
    ("account_profile_change_requests", "account_id", 36),
    ("account_profile_change_requests", "resolved_by_account_id", 36),
    ("password_reset_challenges", "account_id", 36),
    ("dev_deliveries", "id", 36),
    ("dev_deliveries", "account_id", 36),
    ("activity_logs", "id", 36),
    ("activity_logs", "mock_run_id", 36),
    ("domain_events", "actor_account_id", 36),
    ("email_outbox", "id", 36),
    ("email_outbox", "account_id", 36),
    ("email_delivery_attempts", "id", 36),
    ("email_delivery_attempts", "outbox_id", 36),
    ("enterprise_memberships", "account_id", 36),
    ("final_report_artifacts", "generated_by_account_id", 36),
    ("final_report_events", "actor_account_id", 36),
    ("final_report_versions", "prepared_by_account_id", 36),
    ("mock_data_runs", "id", 36),
    ("mock_data_runs", "target_account_id", 36),
    ("mock_data_run_accounts", "run_id", 36),
    ("mock_data_run_accounts", "account_id", 36),
    ("enterprises", "simulation_run_id", 36),
    ("operational_alerts", "id", 36),
    ("site_sync_alert_states", "operational_alert_id", 36),
    ("report_finalizations", "created_by_account_id", 36),
    ("report_review_events", "actor_account_id", 36),
    ("report_revisions", "submitted_by_account_id", 36),
    ("user_notifications", "id", 36),
    ("user_notifications", "recipient_account_id", 36),
    ("user_notifications", "recipient_enterprise_id", 120),
    ("user_notifications", "created_by_account_id", 36),
    ("support_tickets", "id", 36),
    ("support_tickets", "enterprise_account_id", 36),
    ("support_ticket_messages", "id", 36),
    ("support_ticket_messages", "ticket_id", 36),
    ("support_ticket_messages", "author_account_id", 36),
    ("support_attachments", "ticket_id", 36),
)


def upgrade() -> None:
    connection = op.get_bind()
    _normalize_notification_enterprise_identity(connection)
    _require_valid_uuid_values(connection)
    _require_resolved_relationships(connection)

    for table_name, constraint_name in _EXISTING_FOREIGN_KEYS:
        op.drop_constraint(constraint_name, table_name, type_="foreignkey")

    for table_name, column_name, length in _UUID_COLUMNS:
        op.alter_column(
            table_name,
            column_name,
            existing_type=sa.String(length=length),
            type_=sa.Uuid(),
            postgresql_using=f"{column_name}::uuid",
        )

    _create_foreign_keys()


def _normalize_notification_enterprise_identity(connection: Connection) -> None:
    connection.execute(
        sa.text(
            """
            UPDATE user_notifications AS notification
            SET recipient_enterprise_id = enterprise.id::text
            FROM enterprises AS enterprise
            WHERE notification.recipient_enterprise_id IS NOT NULL
              AND NOT pg_input_is_valid(notification.recipient_enterprise_id, 'uuid')
              AND notification.recipient_enterprise_id = enterprise.official_code
            """
        )
    )


def _require_valid_uuid_values(connection: Connection) -> None:
    invalid: list[str] = []
    for table_name, column_name, _length in _UUID_COLUMNS:
        count = int(
            connection.scalar(
                sa.text(
                    f'SELECT count(*) FROM "{table_name}" '
                    f'WHERE "{column_name}" IS NOT NULL '
                    f"AND NOT pg_input_is_valid(\"{column_name}\", 'uuid')"
                )
            )
            or 0
        )
        if count:
            invalid.append(f"{table_name}.{column_name}={count}")
    if invalid:
        raise RuntimeError(
            "Native-UUID cutover blocked by non-UUID structural identities: " + ", ".join(invalid)
        )


def _require_resolved_relationships(connection: Connection) -> None:
    relationships = (
        ("account_email_change_requests", "requested_by_account_id", "accounts"),
        ("account_email_change_requests", "resolved_by_account_id", "accounts"),
        ("password_reset_challenges", "account_id", "accounts"),
        ("dev_deliveries", "account_id", "accounts"),
        ("email_outbox", "account_id", "accounts"),
        ("mock_data_runs", "target_account_id", "accounts"),
        ("activity_logs", "mock_run_id", "mock_data_runs"),
        ("user_notifications", "recipient_account_id", "accounts"),
        ("user_notifications", "recipient_enterprise_id", "enterprises"),
        ("user_notifications", "created_by_account_id", "accounts"),
        ("support_tickets", "enterprise_account_id", "accounts"),
        ("support_ticket_messages", "author_account_id", "accounts"),
    )
    orphaned: list[str] = []
    for table_name, column_name, target_table in relationships:
        count = int(
            connection.scalar(
                sa.text(
                    f'SELECT count(*) FROM "{table_name}" AS source '
                    f'WHERE source."{column_name}" IS NOT NULL AND NOT EXISTS ('
                    f'SELECT 1 FROM "{target_table}" AS target '
                    f'WHERE target.id::text = source."{column_name}"::text)'
                )
            )
            or 0
        )
        if count:
            orphaned.append(f"{table_name}.{column_name}={count}")
    if orphaned:
        raise RuntimeError(
            "Native-UUID cutover blocked by orphaned structural relationships: "
            + ", ".join(orphaned)
        )


def _create_foreign_keys() -> None:
    foreign_keys = (
        (
            "account_activation_tokens_account_id_fkey",
            "account_activation_tokens",
            "accounts",
            ["account_id"],
            ["id"],
            "CASCADE",
        ),
        (
            "account_assets_account_id_fkey",
            "account_assets",
            "accounts",
            ["account_id"],
            ["id"],
            "CASCADE",
        ),
        (
            "account_email_change_requests_account_id_fkey",
            "account_email_change_requests",
            "accounts",
            ["account_id"],
            ["id"],
            "CASCADE",
        ),
        (
            "fk_account_email_change_requested_by",
            "account_email_change_requests",
            "accounts",
            ["requested_by_account_id"],
            ["id"],
            "RESTRICT",
        ),
        (
            "fk_account_email_change_resolved_by",
            "account_email_change_requests",
            "accounts",
            ["resolved_by_account_id"],
            ["id"],
            "RESTRICT",
        ),
        (
            "account_preferences_account_id_fkey",
            "account_preferences",
            "accounts",
            ["account_id"],
            ["id"],
            "CASCADE",
        ),
        (
            "account_profile_change_requests_account_id_fkey",
            "account_profile_change_requests",
            "accounts",
            ["account_id"],
            ["id"],
            "CASCADE",
        ),
        (
            "account_profile_change_requests_resolved_by_account_id_fkey",
            "account_profile_change_requests",
            "accounts",
            ["resolved_by_account_id"],
            ["id"],
            "RESTRICT",
        ),
        (
            "fk_password_reset_challenges_account",
            "password_reset_challenges",
            "accounts",
            ["account_id"],
            ["id"],
            "SET NULL",
        ),
        (
            "fk_dev_deliveries_account",
            "dev_deliveries",
            "accounts",
            ["account_id"],
            ["id"],
            "RESTRICT",
        ),
        (
            "fk_activity_logs_mock_run",
            "activity_logs",
            "mock_data_runs",
            ["mock_run_id"],
            ["id"],
            "SET NULL",
        ),
        (
            "domain_events_actor_account_id_fkey",
            "domain_events",
            "accounts",
            ["actor_account_id"],
            ["id"],
            "RESTRICT",
        ),
        ("fk_email_outbox_account", "email_outbox", "accounts", ["account_id"], ["id"], "RESTRICT"),
        (
            "email_delivery_attempts_outbox_id_fkey",
            "email_delivery_attempts",
            "email_outbox",
            ["outbox_id"],
            ["id"],
            "CASCADE",
        ),
        (
            "enterprise_memberships_account_id_fkey",
            "enterprise_memberships",
            "accounts",
            ["account_id"],
            ["id"],
            "RESTRICT",
        ),
        (
            "final_report_artifacts_generated_by_account_id_fkey",
            "final_report_artifacts",
            "accounts",
            ["generated_by_account_id"],
            ["id"],
            "RESTRICT",
        ),
        (
            "final_report_events_actor_account_id_fkey",
            "final_report_events",
            "accounts",
            ["actor_account_id"],
            ["id"],
            "RESTRICT",
        ),
        (
            "final_report_versions_prepared_by_account_id_fkey",
            "final_report_versions",
            "accounts",
            ["prepared_by_account_id"],
            ["id"],
            "RESTRICT",
        ),
        (
            "fk_mock_data_runs_target_account",
            "mock_data_runs",
            "accounts",
            ["target_account_id"],
            ["id"],
            "SET NULL",
        ),
        (
            "mock_data_run_accounts_account_id_fkey",
            "mock_data_run_accounts",
            "accounts",
            ["account_id"],
            ["id"],
            "CASCADE",
        ),
        (
            "mock_data_run_accounts_run_id_fkey",
            "mock_data_run_accounts",
            "mock_data_runs",
            ["run_id"],
            ["id"],
            "CASCADE",
        ),
        (
            "fk_enterprises_simulation_run_id",
            "enterprises",
            "mock_data_runs",
            ["simulation_run_id"],
            ["id"],
            "RESTRICT",
        ),
        (
            "report_finalizations_created_by_account_id_fkey",
            "report_finalizations",
            "accounts",
            ["created_by_account_id"],
            ["id"],
            "RESTRICT",
        ),
        (
            "report_review_events_actor_account_id_fkey",
            "report_review_events",
            "accounts",
            ["actor_account_id"],
            ["id"],
            "RESTRICT",
        ),
        (
            "report_revisions_submitted_by_account_id_fkey",
            "report_revisions",
            "accounts",
            ["submitted_by_account_id"],
            ["id"],
            "RESTRICT",
        ),
        (
            "site_sync_alert_states_operational_alert_id_fkey",
            "site_sync_alert_states",
            "operational_alerts",
            ["operational_alert_id"],
            ["id"],
            "RESTRICT",
        ),
        (
            "fk_user_notifications_recipient_account",
            "user_notifications",
            "accounts",
            ["recipient_account_id"],
            ["id"],
            "RESTRICT",
        ),
        (
            "fk_user_notifications_recipient_enterprise",
            "user_notifications",
            "enterprises",
            ["recipient_enterprise_id"],
            ["id"],
            "RESTRICT",
        ),
        (
            "fk_user_notifications_created_by",
            "user_notifications",
            "accounts",
            ["created_by_account_id"],
            ["id"],
            "RESTRICT",
        ),
        (
            "fk_support_tickets_enterprise_account",
            "support_tickets",
            "accounts",
            ["enterprise_account_id"],
            ["id"],
            "RESTRICT",
        ),
        (
            "support_attachments_ticket_id_fkey",
            "support_attachments",
            "support_tickets",
            ["ticket_id"],
            ["id"],
            "CASCADE",
        ),
        (
            "support_ticket_messages_ticket_id_fkey",
            "support_ticket_messages",
            "support_tickets",
            ["ticket_id"],
            ["id"],
            "CASCADE",
        ),
        (
            "fk_support_ticket_messages_author",
            "support_ticket_messages",
            "accounts",
            ["author_account_id"],
            ["id"],
            "RESTRICT",
        ),
    )
    for name, source, target, local_columns, remote_columns, ondelete in foreign_keys:
        op.create_foreign_key(
            name,
            source,
            target,
            local_columns,
            remote_columns,
            ondelete=ondelete,
        )


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260714_0035 permanently normalizes structural identities. "
        "Restore the verified external pre-cutover backup and matching application "
        "build instead."
    )
