"""add durable application realtime outbox

Revision ID: 20260723_0002
Revises: 20260720_0001
Create Date: 2026-07-23 23:40:00
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "20260723_0002"
down_revision: str | Sequence[str] | None = "20260720_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TRIGGER_TABLES = (
    "accounts",
    "enterprise_profiles",
    "account_email_change_requests",
    "activity_logs",
    "email_outbox",
    "enterprise_telemetry_snapshots",
    "enterprise_report_submissions",
    "final_reports",
    "operational_alerts",
    "user_notifications",
    "support_tickets",
    "support_ticket_messages",
    "system_configuration",
)


def upgrade() -> None:
    op.create_table(
        "realtime_outbox",
        sa.Column("sequence", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column(
            "event_id",
            sa.String(length=36),
            server_default=sa.text("gen_random_uuid()::text"),
            nullable=False,
        ),
        sa.Column("schema_version", sa.Integer(), server_default="1", nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "scope",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "actor",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "audience_roles",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
        sa.Column("coalesce_key", sa.String(length=160), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("last_error", sa.String(length=1000), nullable=True),
        sa.PrimaryKeyConstraint("sequence"),
        sa.UniqueConstraint("event_id", name="uq_realtime_outbox_event_id"),
        sa.CheckConstraint("schema_version = 1", name="ck_realtime_outbox_schema_version"),
        sa.CheckConstraint("attempt_count >= 0", name="ck_realtime_outbox_attempt_count"),
    )
    op.create_index(
        "ix_realtime_outbox_pending",
        "realtime_outbox",
        ["published_at", "sequence"],
        unique=False,
    )
    op.create_index(
        "uq_realtime_outbox_pending_coalesce",
        "realtime_outbox",
        ["coalesce_key"],
        unique=True,
        postgresql_where=sa.text("published_at IS NULL AND coalesce_key IS NOT NULL"),
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION tanaw_capture_realtime_event()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        DECLARE
            event_type_value text;
            scope_value jsonb := '{}'::jsonb;
            actor_value jsonb := NULL;
            payload_value jsonb := '{}'::jsonb;
            audience_value jsonb := '[]'::jsonb;
            coalesce_value text := NULL;
            ticket_enterprise_account_id text;
            ticket_priority text;
        BEGIN
            IF TG_TABLE_NAME = 'support_tickets' THEN
                IF TG_OP = 'INSERT' THEN
                    event_type_value := 'support_ticket.created';
                ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
                    event_type_value := 'support_ticket.status.changed';
                ELSE
                    event_type_value := 'support_ticket.updated';
                END IF;
                scope_value := jsonb_build_object(
                    'enterprise_account_id', NEW.enterprise_profile_id,
                    'ticket_id', NEW.id
                );
                payload_value := jsonb_build_object(
                    'ticket_id', NEW.id,
                    'status', NEW.status,
                    'priority', NEW.priority,
                    'updated_at', NEW.updated_at
                );
                audience_value := '["admin","it","enterprise"]'::jsonb;

            ELSIF TG_TABLE_NAME = 'support_ticket_messages' THEN
                SELECT enterprise_profile_id, priority
                  INTO ticket_enterprise_account_id, ticket_priority
                  FROM support_tickets
                 WHERE id = NEW.ticket_id;
                event_type_value := 'support_ticket.message.created';
                scope_value := jsonb_build_object(
                    'enterprise_account_id', ticket_enterprise_account_id,
                    'ticket_id', NEW.ticket_id
                );
                actor_value := jsonb_build_object(
                    'user_id', NEW.author_account_id,
                    'role', NEW.author_role
                );
                payload_value := jsonb_build_object(
                    'message_id', NEW.id,
                    'ticket_id', NEW.ticket_id,
                    'author_id', NEW.author_account_id,
                    'author_name', NEW.author_name,
                    'author_role', NEW.author_role,
                    'ticket_priority', ticket_priority,
                    'created_at', NEW.created_at
                );
                audience_value := '["admin","it","enterprise"]'::jsonb;

            ELSIF TG_TABLE_NAME = 'user_notifications' THEN
                event_type_value := CASE
                    WHEN TG_OP = 'INSERT' THEN 'notification.created'
                    ELSE 'notification.updated'
                END;
                scope_value := jsonb_build_object(
                    'recipient_account_id', NEW.recipient_account_id
                );
                actor_value := CASE
                    WHEN NEW.created_by_account_id IS NULL THEN NULL
                    ELSE jsonb_build_object('user_id', NEW.created_by_account_id)
                END;
                payload_value := jsonb_build_object(
                    'notification_id', NEW.id,
                    'recipient_role', NEW.recipient_role,
                    'source_type', NEW.source_type,
                    'source_id', NEW.source_id,
                    'read_at', NEW.read_at,
                    'created_at', NEW.created_at
                );
                audience_value := jsonb_build_array(NEW.recipient_role);

            ELSIF TG_TABLE_NAME = 'operational_alerts' THEN
                IF TG_OP = 'INSERT' THEN
                    event_type_value := 'alert.created';
                ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'Resolved' THEN
                    event_type_value := 'alert.resolved';
                ELSIF OLD.status IS DISTINCT FROM NEW.status AND OLD.status = 'Resolved' THEN
                    event_type_value := 'alert.reopened';
                ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
                    event_type_value := 'alert.status.changed';
                ELSE
                    event_type_value := 'alert.updated';
                END IF;
                payload_value := jsonb_build_object(
                    'alert_id', NEW.id,
                    'owner', NEW.owner,
                    'severity', NEW.severity,
                    'status', NEW.status,
                    'updated_at', NEW.updated_at
                );
                audience_value := CASE NEW.owner
                    WHEN 'Admin' THEN '["admin"]'::jsonb
                    WHEN 'IT' THEN '["it"]'::jsonb
                    ELSE '["admin","it"]'::jsonb
                END;

            ELSIF TG_TABLE_NAME = 'account_email_change_requests' THEN
                IF TG_OP = 'INSERT' THEN
                    event_type_value := 'account_request.created';
                ELSIF NEW.status = 'approved' THEN
                    event_type_value := 'account_request.approved';
                ELSIF NEW.status IN ('rejected', 'cancelled', 'expired', 'replaced') THEN
                    event_type_value := 'account_request.declined';
                ELSE
                    event_type_value := 'account_request.updated';
                END IF;
                scope_value := jsonb_build_object('recipient_account_id', NEW.account_id);
                actor_value := CASE
                    WHEN NEW.resolved_by_account_id IS NULL THEN
                        jsonb_build_object(
                            'user_id', NEW.requested_by_account_id,
                            'role', NEW.requested_by_role
                        )
                    ELSE jsonb_build_object('user_id', NEW.resolved_by_account_id)
                END;
                payload_value := jsonb_build_object(
                    'request_id', NEW.id,
                    'account_id', NEW.account_id,
                    'status', NEW.status,
                    'updated_at', NEW.updated_at
                );
                audience_value := '["it","enterprise"]'::jsonb;

            ELSIF TG_TABLE_NAME = 'accounts' THEN
                IF TG_OP = 'INSERT' THEN
                    event_type_value := 'user.created';
                ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
                    event_type_value := 'user.status.changed';
                ELSE
                    event_type_value := 'user.updated';
                END IF;
                scope_value := jsonb_build_object('recipient_account_id', NEW.id);
                payload_value := jsonb_build_object(
                    'account_id', NEW.id,
                    'role', lower(NEW.role::text),
                    'status', lower(NEW.status::text),
                    'activated', NEW.activated_at IS NOT NULL,
                    'updated_at', NEW.updated_at
                );
                audience_value := CASE
                    WHEN NEW.role = 'ENTERPRISE' THEN '["it","admin","enterprise"]'::jsonb
                    ELSE '["it"]'::jsonb
                END;

            ELSIF TG_TABLE_NAME = 'enterprise_profiles' THEN
                event_type_value := CASE
                    WHEN TG_OP = 'INSERT' THEN 'enterprise.created'
                    ELSE 'enterprise.updated'
                END;
                scope_value := jsonb_build_object(
                    'recipient_account_id', NEW.account_id,
                    'enterprise_account_id', NEW.account_id,
                    'enterprise_id', NEW.enterprise_id
                );
                payload_value := jsonb_build_object(
                    'account_id', NEW.account_id,
                    'enterprise_id', NEW.enterprise_id,
                    'gateway_status', NEW.gateway_status,
                    'updated_at', NEW.updated_at
                );
                audience_value := '["it","admin","enterprise"]'::jsonb;

            ELSIF TG_TABLE_NAME = 'activity_logs' THEN
                event_type_value := 'activity.created';
                payload_value := jsonb_build_object(
                    'activity_id', NEW.id,
                    'category', NEW.category,
                    'severity', NEW.severity,
                    'actor_role', NEW.actor_role,
                    'action', NEW.action,
                    'source_id', NEW.source_id,
                    'timestamp', NEW.timestamp
                );
                audience_value := '["admin","it"]'::jsonb;

            ELSIF TG_TABLE_NAME = 'enterprise_report_submissions' THEN
                IF TG_OP = 'INSERT' THEN
                    event_type_value := 'report.created';
                ELSIF NEW.status ILIKE '%fail%' OR NEW.review_status ILIKE '%reject%' THEN
                    event_type_value := 'report.failed';
                ELSIF NEW.status ILIKE '%final%' OR NEW.review_status = 'Consolidated' THEN
                    event_type_value := 'report.finalized';
                ELSIF NEW.status ILIKE '%process%' THEN
                    event_type_value := 'report.processing';
                ELSE
                    event_type_value := 'report.updated';
                END IF;
                scope_value := jsonb_build_object(
                    'enterprise_account_id', NEW.enterprise_profile_id,
                    'report_id', NEW.id
                );
                payload_value := jsonb_build_object(
                    'report_id', NEW.id,
                    'status', NEW.status,
                    'review_status', NEW.review_status,
                    'updated_at', NEW.updated_at
                );
                audience_value := '["admin","staff","enterprise"]'::jsonb;

            ELSIF TG_TABLE_NAME = 'final_reports' THEN
                IF TG_OP = 'INSERT' THEN
                    event_type_value := 'report.created';
                ELSIF NEW.status = 'Archived' THEN
                    event_type_value := 'report.archived';
                ELSIF NEW.status IN ('Finalized', 'Approved') THEN
                    event_type_value := 'report.finalized';
                ELSIF NEW.status ILIKE '%fail%' OR NEW.status ILIKE '%reject%' THEN
                    event_type_value := 'report.failed';
                ELSE
                    event_type_value := 'report.updated';
                END IF;
                scope_value := jsonb_build_object('report_id', NEW.id);
                payload_value := jsonb_build_object(
                    'report_id', NEW.id,
                    'status', NEW.status,
                    'updated_at', NEW.updated_at
                );
                audience_value := '["admin","staff"]'::jsonb;

            ELSIF TG_TABLE_NAME = 'email_outbox' THEN
                event_type_value := CASE
                    WHEN NEW.provider = 'local' AND NEW.status = 'recorded' THEN 'dev_log.created'
                    ELSE 'email_delivery.updated'
                END;
                scope_value := CASE
                    WHEN NEW.account_id IS NULL THEN '{}'::jsonb
                    ELSE jsonb_build_object('recipient_account_id', NEW.account_id)
                END;
                payload_value := jsonb_build_object(
                    'delivery_id', NEW.id,
                    'status', NEW.status,
                    'purpose', NEW.purpose,
                    'updated_at', NEW.updated_at
                );
                audience_value := '["it"]'::jsonb;

            ELSIF TG_TABLE_NAME = 'enterprise_telemetry_snapshots' THEN
                event_type_value := 'telemetry.updated';
                scope_value := jsonb_build_object(
                    'enterprise_account_id', NEW.enterprise_profile_id
                );
                payload_value := jsonb_build_object(
                    'snapshot_id', NEW.id,
                    'enterprise_account_id', NEW.enterprise_profile_id,
                    'received_at', NEW.received_at
                );
                audience_value := '["admin","it","staff","enterprise"]'::jsonb;
                coalesce_value := 'telemetry:' || NEW.enterprise_profile_id;

            ELSIF TG_TABLE_NAME = 'system_configuration' THEN
                event_type_value := 'system_setting.updated';
                payload_value := jsonb_build_object(
                    'configuration_id', NEW.id,
                    'updated_at', NEW.updated_at
                );
                audience_value := '["admin","it","staff","enterprise"]'::jsonb;
            ELSE
                RETURN NEW;
            END IF;

            IF coalesce_value IS NULL THEN
                INSERT INTO realtime_outbox (
                    event_type, scope, actor, payload, audience_roles
                ) VALUES (
                    event_type_value, scope_value, actor_value, payload_value, audience_value
                );
            ELSE
                INSERT INTO realtime_outbox (
                    event_type, scope, actor, payload, audience_roles, coalesce_key
                ) VALUES (
                    event_type_value,
                    scope_value,
                    actor_value,
                    payload_value,
                    audience_value,
                    coalesce_value
                )
                ON CONFLICT (coalesce_key)
                    WHERE published_at IS NULL AND coalesce_key IS NOT NULL
                DO UPDATE SET
                    occurred_at = now(),
                    scope = EXCLUDED.scope,
                    actor = EXCLUDED.actor,
                    payload = EXCLUDED.payload,
                    audience_roles = EXCLUDED.audience_roles;
            END IF;
            RETURN NEW;
        END;
        $$;
        """
    )

    for table_name in TRIGGER_TABLES:
        operations = "INSERT OR UPDATE" if table_name != "support_ticket_messages" else "INSERT"
        op.execute(
            f"""
            CREATE TRIGGER trg_{table_name}_realtime
            AFTER {operations} ON {table_name}
            FOR EACH ROW EXECUTE FUNCTION tanaw_capture_realtime_event();
            """
        )


def downgrade() -> None:
    for table_name in reversed(TRIGGER_TABLES):
        op.execute(f"DROP TRIGGER IF EXISTS trg_{table_name}_realtime ON {table_name};")
    op.execute("DROP FUNCTION IF EXISTS tanaw_capture_realtime_event();")
    op.drop_index(
        "uq_realtime_outbox_pending_coalesce",
        table_name="realtime_outbox",
        postgresql_where=sa.text("published_at IS NULL AND coalesce_key IS NOT NULL"),
    )
    op.drop_index("ix_realtime_outbox_pending", table_name="realtime_outbox")
    op.drop_table("realtime_outbox")
