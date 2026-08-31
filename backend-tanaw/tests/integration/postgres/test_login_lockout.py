from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.core.security import hash_password
from app.db.session import get_db
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.auth import session_router
from app.features.auth.service import LoginLockoutPolicy
from app.features.monitoring.models import OperationalAlert
from app.features.notifications.models import UserNotification
from app.features.realtime.models import RealtimeOutbox
from tests.support.postgres import PostgresRuntime, postgres_test_database_url

TEST_EMAIL_PATTERN = "tanaw-login-lockout-pg-%@example.com"
TEST_ACCOUNT_ID_PREFIX = "login-lockout-pg-"


@pytest_asyncio.fixture
async def postgres_runtime(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[PostgresRuntime]:
    database_url = postgres_test_database_url()
    engine = create_async_engine(database_url, pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    settings = Settings(
        environment="development",
        database_url=database_url,
        jwt_secret_key="tanaw-login-lockout-postgres-jwt-secret-123456789",
    )

    async def default_lockout_policy(_: AsyncSession) -> LoginLockoutPolicy:
        return LoginLockoutPolicy()

    async def lockout_notifications_enabled(
        _: AsyncSession, __: str, *, default: bool = True
    ) -> bool:
        del default
        return True

    monkeypatch.setattr(session_router, "get_login_lockout_policy", default_lockout_policy)
    monkeypatch.setattr(
        session_router,
        "system_setting_enabled",
        lockout_notifications_enabled,
    )

    runtime = PostgresRuntime(engine=engine, sessions=sessions, settings=settings)
    await _clean_rows(runtime)
    try:
        yield runtime
    finally:
        await _clean_rows(runtime)
        await engine.dispose()


async def _clean_rows(runtime: PostgresRuntime) -> None:
    async with runtime.sessions() as db:
        account_ids = list(
            await db.scalars(select(Account.id).where(Account.email.like(TEST_EMAIL_PATTERN)))
        )
        alert_rows = list(
            (
                await db.execute(
                    select(OperationalAlert.id, OperationalAlert.alert_code).where(
                        OperationalAlert.source_id.like(
                            f"failed-login-threshold:{TEST_ACCOUNT_ID_PREFIX}%"
                        )
                    )
                )
            ).all()
        )
        alert_ids = [row.id for row in alert_rows]
        alert_codes = [row.alert_code for row in alert_rows]
        notification_ids = (
            list(
                await db.scalars(
                    select(UserNotification.id).where(
                        UserNotification.source_type == "operational.alert",
                        UserNotification.source_id.in_(alert_codes),
                    )
                )
            )
            if alert_codes
            else []
        )

        outbox_conditions = []
        if account_ids:
            outbox_conditions.append(
                RealtimeOutbox.payload["account_id"].as_string().in_(account_ids)
            )
        if alert_ids:
            outbox_conditions.append(RealtimeOutbox.payload["alert_id"].as_string().in_(alert_ids))
        if notification_ids:
            outbox_conditions.append(
                RealtimeOutbox.payload["notification_id"].as_string().in_(notification_ids)
            )
        if outbox_conditions:
            await db.execute(delete(RealtimeOutbox).where(or_(*outbox_conditions)))
        if notification_ids:
            await db.execute(
                delete(UserNotification).where(UserNotification.id.in_(notification_ids))
            )
        if alert_ids:
            await db.execute(delete(OperationalAlert).where(OperationalAlert.id.in_(alert_ids)))
        if account_ids:
            await db.execute(delete(Account).where(Account.id.in_(account_ids)))
        await db.commit()


async def _create_test_accounts(runtime: PostgresRuntime) -> tuple[Account, Account]:
    now = datetime.now(UTC)
    suffix = uuid4().hex[:12]
    locked_account = Account(
        id=f"{TEST_ACCOUNT_ID_PREFIX}{suffix}",
        email=f"tanaw-login-lockout-pg-user-{suffix}@example.com",
        password_hash=hash_password("Correct login lockout test password"),
        role=AccountRole.STAFF,
        display_name="Login Lockout Test User",
        title="LGU Staff",
        status=AccountStatus.ACTIVE,
        activated_at=now,
        password_changed_at=now,
        failed_login_attempts=2,
    )
    it_recipient = Account(
        id=f"{TEST_ACCOUNT_ID_PREFIX}it-{suffix}",
        email=f"tanaw-login-lockout-pg-it-{suffix}@example.com",
        password_hash=hash_password("IT notification recipient test password"),
        role=AccountRole.IT,
        display_name="Login Lockout Test IT",
        title="IT Personnel",
        status=AccountStatus.ACTIVE,
        activated_at=now,
        password_changed_at=now,
    )
    async with runtime.sessions() as db:
        db.add_all([locked_account, it_recipient])
        await db.commit()
    return locked_account, it_recipient


def _create_test_app(runtime: PostgresRuntime) -> FastAPI:
    application = FastAPI()
    application.include_router(session_router.router)

    async def test_db() -> AsyncIterator[AsyncSession]:
        async with runtime.sessions() as db:
            try:
                yield db
                await db.commit()
            except BaseException:
                await db.rollback()
                raise

    application.dependency_overrides[get_db] = test_db
    return application


@pytest.mark.asyncio
async def test_failed_login_threshold_persists_lockout_alert_and_it_notification(
    postgres_runtime: PostgresRuntime,
) -> None:
    locked_account, it_recipient = await _create_test_accounts(postgres_runtime)
    application = _create_test_app(postgres_runtime)
    transport = ASGITransport(app=application)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/auth/login",
            json={
                "username": locked_account.email,
                "password": "Incorrect login lockout test password",
                "loginScope": "web",
                "rememberMe": False,
            },
        )

        assert response.status_code == 429
        assert int(response.headers["Retry-After"]) > 0
        assert response.json()["detail"]["retryAfterSeconds"] > 0

        repeated_response = await client.post(
            "/auth/login",
            json={
                "username": locked_account.email,
                "password": "Incorrect login lockout test password",
                "loginScope": "web",
                "rememberMe": False,
            },
        )
        assert repeated_response.status_code == 429

    async with postgres_runtime.sessions() as db:
        stored_account = await db.get(Account, locked_account.id)
        assert stored_account is not None
        assert stored_account.failed_login_attempts == 0
        assert stored_account.locked_until is not None
        assert stored_account.locked_until > datetime.now(UTC)

        alerts = list(
            await db.scalars(
                select(OperationalAlert).where(
                    OperationalAlert.source_id == f"failed-login-threshold:{locked_account.id}",
                    OperationalAlert.alert_type == "Failed Login Threshold",
                    OperationalAlert.status != "Resolved",
                )
            )
        )
        assert len(alerts) == 1

        notifications = list(
            await db.scalars(
                select(UserNotification).where(
                    UserNotification.recipient_account_id == it_recipient.id,
                    UserNotification.source_type == "operational.alert",
                    UserNotification.source_id == alerts[0].alert_code,
                    UserNotification.notification_type == "Locked Account",
                )
            )
        )
        assert len(notifications) == 1
