import base64
import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core import security
from app.core.config import Settings
from app.core.security import create_access_token
from app.db.session import get_db
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
)
from app.features.realtime.models import RealtimeOutbox
from app.features.support import router as support_router
from app.features.support.models import SupportTicket
from tests.support.postgres import PostgresRuntime, postgres_test_database_url

TEST_EMAIL_PATTERN = "tanaw-support-attachment-pg-%@example.com"


@pytest_asyncio.fixture
async def postgres_runtime(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[PostgresRuntime]:
    database_url = postgres_test_database_url()
    engine = create_async_engine(database_url, pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    settings = Settings(
        environment="development",
        database_url=database_url,
        jwt_secret_key="tanaw-support-attachment-postgres-jwt-secret-123456789",
    )
    monkeypatch.setattr(security, "get_settings", lambda: settings)
    monkeypatch.setattr(
        support_router,
        "create_role_notifications",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(
        support_router,
        "record_operational_log",
        AsyncMock(return_value=None),
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
            await db.execute(
                delete(RealtimeOutbox).where(
                    RealtimeOutbox.payload["ticket_id"].as_string().in_(ticket_ids)
                )
            )
            await db.execute(delete(SupportTicket).where(SupportTicket.id.in_(ticket_ids)))
        if account_ids:
            await db.execute(delete(Account).where(Account.id.in_(account_ids)))
        await db.commit()


async def _create_enterprise(runtime: PostgresRuntime, *, label: str) -> Account:
    suffix = uuid4().hex[:12]
    account = Account(
        id=str(uuid4()),
        email=f"tanaw-support-attachment-pg-{label}-{suffix}@example.com",
        password_hash="unused-test-password-hash",
        role=AccountRole.ENTERPRISE,
        display_name=f"Attachment Test {label}",
        title="Enterprise Account",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
        password_changed_at=datetime.now(UTC),
        enterprise_profile=EnterpriseProfile(
            enterprise_id=f"attachment-test-{label}-{suffix}",
            enterprise_name=f"Attachment Test {label}",
            category="business",
            manager_name=f"Test Manager {label}",
            barangay="Poblacion",
        ),
    )
    async with runtime.sessions() as db:
        db.add(account)
        await db.commit()
    return account


def _create_test_app(runtime: PostgresRuntime) -> FastAPI:
    application = FastAPI()
    application.include_router(support_router.router)

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
async def test_ticket_responses_expose_metadata_and_attachment_endpoint_returns_content(
    postgres_runtime: PostgresRuntime,
) -> None:
    owner = await _create_enterprise(postgres_runtime, label="owner")
    other_enterprise = await _create_enterprise(postgres_runtime, label="other")
    content = b"recognizable-support-attachment-payload"
    encoded_content = base64.b64encode(content).decode()
    payload = {
        "category": "Other",
        "priority": "Normal",
        "subject": "Attachment response boundary",
        "description": "Verify that attachment content stays out of ticket responses.",
        "affectedArea": "Enterprise portal",
        "attachments": [
            {
                "fileName": "evidence.png",
                "mediaType": "image/png",
                "sizeBytes": len(content),
                "dataUrl": f"data:image/png;base64,{encoded_content}",
            }
        ],
    }
    application = _create_test_app(postgres_runtime)
    transport = ASGITransport(app=application)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        create_response = await client.post(
            "/operational/tickets",
            headers=_authorization(owner),
            json=payload,
        )
        assert create_response.status_code == 201
        created = create_response.json()
        ticket_id = created["id"]
        attachment_url = f"/operational/tickets/{ticket_id}/attachments/0"
        expected_metadata = {
            "id": f"{ticket_id}:0",
            "fileName": "evidence.png",
            "mediaType": "image/png",
            "sizeBytes": len(content),
            "url": attachment_url,
        }
        assert created["attachments"] == [expected_metadata]
        assert "dataUrl" not in json.dumps(created)
        assert encoded_content[:24] not in json.dumps(created)

        list_response = await client.get(
            "/operational/tickets",
            headers=_authorization(owner),
        )
        assert list_response.status_code == 200
        listed_ticket = next(ticket for ticket in list_response.json() if ticket["id"] == ticket_id)
        assert listed_ticket["attachments"] == [expected_metadata]
        serialized_list = json.dumps(list_response.json())
        assert "dataUrl" not in serialized_list
        assert encoded_content[:24] not in serialized_list

        detail_response = await client.get(
            f"/operational/tickets/{ticket_id}",
            headers=_authorization(owner),
        )
        assert detail_response.status_code == 200
        assert detail_response.json()["attachments"] == [expected_metadata]
        serialized_detail = json.dumps(detail_response.json())
        assert "dataUrl" not in serialized_detail
        assert encoded_content[:24] not in serialized_detail

        attachment_response = await client.get(
            attachment_url,
            headers=_authorization(owner),
        )
        assert attachment_response.status_code == 200
        assert attachment_response.content == content
        assert attachment_response.headers["content-type"] == "image/png"
        assert attachment_response.headers["content-disposition"] == (
            'inline; filename="evidence.png"'
        )

        unauthenticated_response = await client.get(attachment_url)
        assert unauthenticated_response.status_code == 401

        unauthorized_response = await client.get(
            attachment_url,
            headers=_authorization(other_enterprise),
        )
        assert unauthorized_response.status_code == 404

        missing_response = await client.get(
            f"/operational/tickets/{ticket_id}/attachments/1",
            headers=_authorization(owner),
        )
        assert missing_response.status_code == 404
