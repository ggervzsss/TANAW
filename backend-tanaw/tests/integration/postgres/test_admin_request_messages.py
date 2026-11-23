from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.security import create_access_token
from app.db.session import get_db
from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.activity_logs.models import ActivityLog
from app.features.admin_requests import router as admin_requests_router
from app.features.notifications.models import UserNotification
from app.features.realtime.models import RealtimeOutbox
from app.features.support.models import SupportTicket, SupportTicketMessage
from tests.support.postgres import PostgresRuntime, open_postgres_runtime

TEST_EMAIL_PATTERN = "tanaw-admin-request-pg-%@example.com"


@pytest_asyncio.fixture
async def postgres_runtime(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[PostgresRuntime]:
    async with open_postgres_runtime(
        _clean_rows,
        jwt_secret_key="tanaw-admin-request-postgres-jwt-secret-123456789",
    ) as runtime:
        settings = runtime.settings
        monkeypatch.setattr(security, "get_settings", lambda: settings)
        yield runtime


async def _clean_rows(runtime: PostgresRuntime) -> None:
    async with runtime.sessions() as db:
        account_ids = list(
            await db.scalars(select(Account.id).where(Account.email.like(TEST_EMAIL_PATTERN)))
        )
        ticket_ids = (
            list(
                await db.scalars(
                    select(SupportTicket.id).where(
                        SupportTicket.enterprise_profile_id.in_(account_ids)
                    )
                )
            )
            if account_ids
            else []
        )
        if ticket_ids:
            await db.execute(delete(ActivityLog).where(ActivityLog.source_id.in_(ticket_ids)))
            await db.execute(
                delete(RealtimeOutbox).where(
                    RealtimeOutbox.payload["ticket_id"].as_string().in_(ticket_ids)
                )
            )
            await db.execute(delete(SupportTicket).where(SupportTicket.id.in_(ticket_ids)))
        if account_ids:
            await db.execute(delete(Account).where(Account.id.in_(account_ids)))
        await db.commit()


async def _create_account(runtime: PostgresRuntime, role: AccountRole, label: str) -> Account:
    suffix = uuid4().hex[:12]
    account = Account(
        id=str(uuid4()),
        email=f"tanaw-admin-request-pg-{label}-{suffix}@example.com",
        password_hash="unused-test-password-hash",
        role=role,
        display_name=f"Request Test {label}",
        title=role.value.title(),
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
        password_changed_at=datetime.now(UTC),
    )
    if role == AccountRole.ENTERPRISE:
        account.enterprise_profile = EnterpriseProfile(
            enterprise_id=f"admin-request-test-{suffix}",
            enterprise_name=f"Request Test Enterprise {suffix}",
            attraction_code="411",
            manager_name="Test Manager",
            barangay="Poblacion",
        )
    async with runtime.sessions() as db:
        db.add(account)
        await db.commit()
    return account


async def _create_ticket(runtime: PostgresRuntime, enterprise: Account, priority: str) -> str:
    ticket = SupportTicket(
        ticket_code=f"TCK-T{uuid4().hex[:12].upper()}",
        enterprise_profile_id=enterprise.id,
        enterprise_name="Request Test Enterprise",
        category="Camera Issue",
        priority=priority,
        subject="Entrance camera is offline",
        description="The entrance camera stopped counting visitors.",
    )
    async with runtime.sessions() as db:
        db.add(ticket)
        await db.commit()
        return ticket.id


def _create_test_app(runtime: PostgresRuntime) -> FastAPI:
    application = FastAPI()
    application.include_router(admin_requests_router.router)

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


def _authorization(account: Account) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(account.id)}"}


@pytest.mark.asyncio
async def test_admin_message_notifies_it_without_joining_the_ticket_conversation(
    postgres_runtime: PostgresRuntime,
) -> None:
    admin = await _create_account(postgres_runtime, AccountRole.ADMIN, "admin")
    it_account = await _create_account(postgres_runtime, AccountRole.IT, "it")
    enterprise = await _create_account(postgres_runtime, AccountRole.ENTERPRISE, "enterprise")
    urgent_ticket_id = await _create_ticket(postgres_runtime, enterprise, "Urgent")
    normal_ticket_id = await _create_ticket(postgres_runtime, enterprise, "Normal")

    async with AsyncClient(
        transport=ASGITransport(app=_create_test_app(postgres_runtime)),
        base_url="http://test",
    ) as client:
        response = await client.post(
            "/operational/requests/messages",
            headers=_authorization(admin),
            json={
                "sourceType": "support.ticket",
                "sourceId": urgent_ticket_id,
                "message": "  Please send someone on site today.  ",
            },
        )
        assert response.status_code == 201
        body = response.json()
        assert body["recipientCount"] >= 1
        assert body["activity"]["action"] == "Message IT"
        assert body["activity"]["sourceId"] == urgent_ticket_id
        assert body["activity"]["metadata"]["message"] == "Please send someone on site today."

        hidden_response = await client.post(
            "/operational/requests/messages",
            headers=_authorization(admin),
            json={
                "sourceType": "support.ticket",
                "sourceId": normal_ticket_id,
                "message": "Please check this.",
            },
        )
        assert hidden_response.status_code == 404

        it_response = await client.post(
            "/operational/requests/messages",
            headers=_authorization(it_account),
            json={
                "sourceType": "support.ticket",
                "sourceId": urgent_ticket_id,
                "message": "Please check this.",
            },
        )
        assert it_response.status_code == 403

    async with postgres_runtime.sessions() as db:
        notification = await db.scalar(
            select(UserNotification).where(
                UserNotification.recipient_account_id == it_account.id,
                UserNotification.source_type == "support.ticket",
                UserNotification.source_id == urgent_ticket_id,
            )
        )
        assert notification is not None
        assert notification.message == "Please send someone on site today."
        assert notification.created_by_account_id == admin.id

        enterprise_notifications = await db.scalar(
            select(func.count())
            .select_from(UserNotification)
            .where(UserNotification.recipient_account_id == enterprise.id)
        )
        assert enterprise_notifications == 0
        ticket_messages = await db.scalar(
            select(func.count())
            .select_from(SupportTicketMessage)
            .where(SupportTicketMessage.ticket_id == urgent_ticket_id)
        )
        assert ticket_messages == 0
        log = await db.scalar(
            select(ActivityLog).where(
                ActivityLog.source_id == urgent_ticket_id, ActivityLog.action == "Message IT"
            )
        )
        assert log is not None
        assert log.category == "Admin Operation"
