from sqlalchemy import String, Uuid

from app.db.base import Base


def test_structural_primary_and_foreign_keys_use_native_uuids() -> None:
    uuid_columns = {
        "accounts.id",
        "activity_logs.id",
        "email_outbox.id",
        "email_delivery_attempts.id",
        "simulation_runs.id",
        "operational_alerts.id",
        "user_notifications.id",
        "support_tickets.id",
        "support_ticket_messages.id",
    }
    uuid_columns.update(
        f"{table.name}.{column.name}"
        for table in Base.metadata.tables.values()
        for column in table.columns
        if any(foreign_key.target_fullname == "accounts.id" for foreign_key in column.foreign_keys)
    )
    uuid_columns.update(
        {
            "activity_logs.simulation_run_id",
            "email_delivery_attempts.outbox_id",
            "enterprises.simulation_run_id",
            "simulation_run_accounts.run_id",
            "site_sync_alert_states.operational_alert_id",
            "support_attachments.ticket_id",
            "support_ticket_messages.ticket_id",
            "user_notifications.recipient_enterprise_id",
        }
    )

    for qualified_name in sorted(uuid_columns):
        table_name, column_name = qualified_name.split(".")
        assert isinstance(Base.metadata.tables[table_name].c[column_name].type, Uuid), (
            qualified_name
        )


def test_opaque_and_business_identifiers_remain_strings() -> None:
    string_columns = {
        "account_activation_tokens.id",
        "account_email_change_requests.id",
        "email_outbox.source_id",
        "simulation_runs.target_enterprise_id",
        "password_reset_challenges.id",
        "password_reset_rate_limit_buckets.bucket_key",
        "support_tickets.enterprise_id",
        "seed_states.id",
        "system_settings.id",
    }
    for qualified_name in sorted(string_columns):
        table_name, column_name = qualified_name.split(".")
        assert isinstance(Base.metadata.tables[table_name].c[column_name].type, String), (
            qualified_name
        )


def test_retained_operational_relationships_have_real_foreign_keys() -> None:
    expected_targets = {
        "activity_logs.simulation_run_id": "simulation_runs.id",
        "email_outbox.account_id": "accounts.id",
        "system_settings.updated_by_account_id": "accounts.id",
        "simulation_runs.target_account_id": "accounts.id",
        "password_reset_challenges.account_id": "accounts.id",
        "support_ticket_messages.author_account_id": "accounts.id",
        "support_tickets.enterprise_account_id": "accounts.id",
        "user_notifications.created_by_account_id": "accounts.id",
        "user_notifications.recipient_account_id": "accounts.id",
        "user_notifications.recipient_enterprise_id": "enterprises.id",
    }
    for qualified_name, expected_target in expected_targets.items():
        table_name, column_name = qualified_name.split(".")
        targets = {
            foreign_key.target_fullname
            for foreign_key in Base.metadata.tables[table_name].c[column_name].foreign_keys
        }
        assert targets == {expected_target}, qualified_name
