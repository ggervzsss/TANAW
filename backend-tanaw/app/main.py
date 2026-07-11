from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse, Response

from app.api.router import api_router
from app.core.config import get_settings
from app.core.http_security import apply_security_headers
from app.db.base import Base
from app.db.session import AsyncSessionLocal, engine
from app.features.accounts.seed import seed_default_accounts
from app.features.mail.service import EmailDeliveryError


async def ensure_account_onboarding_schema(connection: Any) -> None:
    statements = [
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS phone VARCHAR(40)",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS first_name VARCHAR(60)",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_name VARCHAR(60)",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS enterprise_name VARCHAR(120)",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS category VARCHAR(120)",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS manager_name VARCHAR(120)",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS barangay VARCHAR(120)",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS address VARCHAR(255)",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS location_source VARCHAR(40)",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS location_confidence DOUBLE PRECISION",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS geocoded_address VARCHAR(500)",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS enterprise_id VARCHAR(120)",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS gateway_id VARCHAR(120)",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS gateway_status VARCHAR(40)",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS building_capacity INTEGER NOT NULL DEFAULT 100",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS activated_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS token_invalid_before TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP WITH TIME ZONE",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS preferences_json TEXT",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS source_kind VARCHAR(20) NOT NULL DEFAULT 'real'",
        "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS mock_run_id VARCHAR(36)",
    ]
    for statement in statements:
        await connection.exec_driver_sql(statement)
    await connection.exec_driver_sql(
        """
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = current_schema()
                  AND table_name = 'accounts'
                  AND column_name = 'must_change_password'
            ) THEN
                UPDATE accounts
                SET activated_at = COALESCE(password_changed_at, created_at, now())
                WHERE must_change_password = false AND activated_at IS NULL;

                UPDATE accounts
                SET token_invalid_before = now()
                WHERE must_change_password = true;
            END IF;
        END $$
        """
    )
    await connection.exec_driver_sql(
        "ALTER TABLE accounts DROP COLUMN IF EXISTS temporary_password_expires_at"
    )
    await connection.exec_driver_sql(
        "ALTER TABLE accounts DROP COLUMN IF EXISTS temporary_password_created_at"
    )
    await connection.exec_driver_sql(
        "ALTER TABLE accounts DROP COLUMN IF EXISTS must_change_password"
    )
    await connection.exec_driver_sql(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_accounts_enterprise_id ON accounts (enterprise_id)"
    )
    await connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_accounts_mock_run_id ON accounts (mock_run_id)"
    )
    await connection.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS activity_logs (
            id VARCHAR(36) PRIMARY KEY,
            timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            category VARCHAR(40) NOT NULL,
            severity VARCHAR(20) NOT NULL,
            actor VARCHAR(120) NOT NULL,
            actor_role VARCHAR(40) NOT NULL,
            action VARCHAR(120) NOT NULL,
            target VARCHAR(255) NOT NULL,
            summary TEXT NOT NULL,
            source_id VARCHAR(120),
            metadata_json TEXT,
            source_kind VARCHAR(20) NOT NULL DEFAULT 'real',
            mock_run_id VARCHAR(36)
        )
        """,
    )
    await connection.exec_driver_sql(
        "ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS source_kind VARCHAR(20) NOT NULL DEFAULT 'real'"
    )
    await connection.exec_driver_sql(
        "ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS mock_run_id VARCHAR(36)"
    )
    await connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_activity_logs_category ON activity_logs (category)"
    )
    await connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_activity_logs_actor_role ON activity_logs (actor_role)"
    )
    await connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_activity_logs_mock_run_id ON activity_logs (mock_run_id)"
    )


async def ensure_mock_reporting_schema(connection: Any) -> None:
    statements = [
        "ALTER TABLE enterprise_telemetry_snapshots ADD COLUMN IF NOT EXISTS source_kind VARCHAR(20) NOT NULL DEFAULT 'real'",
        "ALTER TABLE enterprise_telemetry_snapshots ADD COLUMN IF NOT EXISTS mock_run_id VARCHAR(36)",
        "ALTER TABLE enterprise_report_submissions ADD COLUMN IF NOT EXISTS source_kind VARCHAR(20) NOT NULL DEFAULT 'real'",
        "ALTER TABLE enterprise_report_submissions ADD COLUMN IF NOT EXISTS mock_run_id VARCHAR(36)",
    ]
    for statement in statements:
        await connection.exec_driver_sql(statement)

    await connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_enterprise_telemetry_snapshots_mock_run_id ON enterprise_telemetry_snapshots (mock_run_id)"
    )
    await connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_enterprise_report_submissions_mock_run_id ON enterprise_report_submissions (mock_run_id)"
    )
    await connection.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS final_reports (
            id VARCHAR(36) PRIMARY KEY,
            report_code VARCHAR(80) NOT NULL UNIQUE,
            title VARCHAR(160) NOT NULL,
            period VARCHAR(120) NOT NULL,
            generated_on TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            prepared_by VARCHAR(120) NOT NULL,
            prepared_role VARCHAR(120) NOT NULL DEFAULT 'Staff Processing Division',
            status VARCHAR(40) NOT NULL DEFAULT 'Draft',
            archived_from_status VARCHAR(40),
            total_entry INTEGER NOT NULL DEFAULT 0,
            total_exit INTEGER NOT NULL DEFAULT 0,
            total_unique INTEGER NOT NULL DEFAULT 0,
            enterprise_count INTEGER NOT NULL DEFAULT 0,
            source_kind VARCHAR(20) NOT NULL DEFAULT 'real',
            mock_run_id VARCHAR(36),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """,
    )
    await connection.exec_driver_sql(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_final_reports_report_code ON final_reports (report_code)"
    )
    await connection.exec_driver_sql(
        "ALTER TABLE final_reports ADD COLUMN IF NOT EXISTS archived_from_status VARCHAR(40)"
    )
    await connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_final_reports_period ON final_reports (period)"
    )
    await connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_final_reports_mock_run_id ON final_reports (mock_run_id)"
    )
    await connection.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS final_report_sources (
            id VARCHAR(36) PRIMARY KEY,
            final_report_id VARCHAR(36) NOT NULL REFERENCES final_reports(id) ON DELETE CASCADE,
            intake_report_id VARCHAR(36) NOT NULL,
            enterprise_id VARCHAR(120) NOT NULL,
            enterprise VARCHAR(120) NOT NULL,
            code VARCHAR(80) NOT NULL,
            unique_count INTEGER NOT NULL DEFAULT 0,
            entries INTEGER NOT NULL DEFAULT 0,
            exits INTEGER NOT NULL DEFAULT 0,
            CONSTRAINT uq_final_report_source UNIQUE (final_report_id, intake_report_id)
        )
        """,
    )
    await connection.exec_driver_sql(
        "ALTER TABLE final_report_sources ADD COLUMN IF NOT EXISTS enterprise_id VARCHAR(120)"
    )
    await connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_final_report_sources_final_report_id ON final_report_sources (final_report_id)"
    )
    await connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_final_report_sources_enterprise_id ON final_report_sources (enterprise_id)"
    )
    await connection.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS mock_data_runs (
            id VARCHAR(36) PRIMARY KEY,
            scenario VARCHAR(80) NOT NULL,
            seed VARCHAR(80) NOT NULL,
            range_start TIMESTAMP WITH TIME ZONE NOT NULL,
            range_end TIMESTAMP WITH TIME ZONE NOT NULL,
            target_account_id VARCHAR(36),
            target_enterprise_id VARCHAR(120),
            target_enterprise_name VARCHAR(120),
            status VARCHAR(40) NOT NULL DEFAULT 'active',
            generated_counts_json TEXT,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            ended_at TIMESTAMP WITH TIME ZONE
        )
        """,
    )
    await connection.exec_driver_sql(
        "ALTER TABLE mock_data_runs ADD COLUMN IF NOT EXISTS target_account_id VARCHAR(36)"
    )
    await connection.exec_driver_sql(
        "ALTER TABLE mock_data_runs ADD COLUMN IF NOT EXISTS target_enterprise_id VARCHAR(120)"
    )
    await connection.exec_driver_sql(
        "ALTER TABLE mock_data_runs ADD COLUMN IF NOT EXISTS target_enterprise_name VARCHAR(120)"
    )


async def ensure_notifications_schema(connection: Any) -> None:
    await connection.exec_driver_sql(
        """
        CREATE TABLE IF NOT EXISTS user_notifications (
            id VARCHAR(36) PRIMARY KEY,
            recipient_account_id VARCHAR(36) NOT NULL,
            recipient_role VARCHAR(40) NOT NULL,
            recipient_enterprise_id VARCHAR(120),
            title VARCHAR(160) NOT NULL,
            message TEXT NOT NULL,
            notification_type VARCHAR(60) NOT NULL,
            severity VARCHAR(20) NOT NULL DEFAULT 'Info',
            source_type VARCHAR(80),
            source_id VARCHAR(120),
            created_by_account_id VARCHAR(36),
            created_by_name VARCHAR(120),
            read_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
        )
        """,
    )
    await connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_user_notifications_recipient_account_id ON user_notifications (recipient_account_id)"
    )
    await connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_user_notifications_recipient_role ON user_notifications (recipient_role)"
    )
    await connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_user_notifications_recipient_enterprise_id ON user_notifications (recipient_enterprise_id)"
    )
    await connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_user_notifications_notification_type ON user_notifications (notification_type)"
    )
    await connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_user_notifications_severity ON user_notifications (severity)"
    )
    await connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_user_notifications_source_id ON user_notifications (source_id)"
    )
    await connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_user_notifications_created_at ON user_notifications (created_at)"
    )


async def ensure_support_ticket_schema(connection: Any) -> None:
    await connection.exec_driver_sql(
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS attachments_json TEXT"
    )


async def ensure_email_schema(connection: Any) -> None:
    await connection.exec_driver_sql("DROP TABLE IF EXISTS inbound_email_receipts")
    statements = [
        "ALTER TABLE dev_deliveries ADD COLUMN IF NOT EXISTS provider VARCHAR(40) NOT NULL DEFAULT 'local'",
        "ALTER TABLE dev_deliveries ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(120)",
        "ALTER TABLE dev_deliveries ADD COLUMN IF NOT EXISTS error_message TEXT",
    ]
    for statement in statements:
        await connection.exec_driver_sql(statement)
    await connection.exec_driver_sql(
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
    await connection.exec_driver_sql("DROP TYPE IF EXISTS delivery_channel")
    await connection.exec_driver_sql(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_dev_deliveries_provider_message_id ON dev_deliveries (provider_message_id)"
    )


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        await ensure_account_onboarding_schema(connection)
        await ensure_mock_reporting_schema(connection)
        await ensure_notifications_schema(connection)
        await ensure_support_ticket_schema(connection)
        await ensure_email_schema(connection)

    async with AsyncSessionLocal() as session:
        await seed_default_accounts(session)

    yield


settings = get_settings()
app = FastAPI(title=settings.app_name, lifespan=lifespan)


@app.exception_handler(EmailDeliveryError)
async def email_delivery_error_handler(_: Request, __: EmailDeliveryError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "detail": "TANAW could not deliver the email. Verify the email configuration and try again."
        },
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "HEAD", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    response = await call_next(request)
    apply_security_headers(request, response)
    return response


app.include_router(api_router)


@app.get("/health")
@app.head("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
