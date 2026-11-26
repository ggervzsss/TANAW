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
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.security import create_access_token
from app.db.session import get_db
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
)
from app.features.realtime.models import RealtimeOutbox
from app.features.requests import router as support_router
from app.features.requests.models import Request as SupportTicket
from app.features.requests.service import list_requests
from tests.support.postgres import PostgresRuntime, open_postgres_runtime

TEST_EMAIL_PATTERN = "tanaw-support-attachment-pg-%@example.com"


@pytest_asyncio.fixture
async def postgres_runtime(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[PostgresRuntime]:
    async with open_postgres_runtime(
        _clean_rows,
        jwt_secret_key="tanaw-support-attachment-postgres-jwt-secret-123456789",
    ) as runtime:
        settings = runtime.settings
        monkeypatch.setattr(security, "get_settings", lambda: settings)
        monkeypatch.setattr(
            support_router,
            "create_role_notifications",
            AsyncMock(return_value=[]),
        )
        monkeypatch.setattr(
            support_router,
            "record_activity_log",
            AsyncMock(return_value=None),
        )
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
            await db.execute(
                delete(RealtimeOutbox).where(
                    RealtimeOutbox.payload["request_id"].as_string().in_(ticket_ids)
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
            attraction_code="411",
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
        "group": "Other",
        "title": "Attachment response boundary",
        "description": "Verify that attachment content stays out of request responses.",
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
            "/operational/requests",
            headers=_authorization(owner),
            json=payload,
        )
        assert create_response.status_code == 201
        created = create_response.json()
        ticket_id = created["id"]
        attachment_url = f"/operational/requests/{ticket_id}/attachments/0"
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
            "/operational/requests",
            headers=_authorization(owner),
        )
        assert list_response.status_code == 200
        listed_ticket = next(ticket for ticket in list_response.json() if ticket["id"] == ticket_id)
        assert listed_ticket["attachments"] == [expected_metadata]
        serialized_list = json.dumps(list_response.json())
        assert "dataUrl" not in serialized_list
        assert encoded_content[:24] not in serialized_list

        detail_response = await client.get(
            f"/operational/requests/{ticket_id}",
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
            f"/operational/requests/{ticket_id}/attachments/1",
            headers=_authorization(owner),
        )
        assert missing_response.status_code == 404


@pytest.mark.asyncio
async def test_listing_account_changes_reads_the_current_value_without_lazy_loading(
    postgres_runtime: PostgresRuntime,
) -> None:
    enterprise = await _create_enterprise(postgres_runtime, label="change")
    viewer = Account(
        id=str(uuid4()),
        email=f"tanaw-support-attachment-pg-admin-{uuid4().hex[:12]}@example.com",
        password_hash="unused-test-password-hash",
        role=AccountRole.ADMIN,
        display_name="Admin reader",
        title="Administrator",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
    )
    async with postgres_runtime.sessions() as db:
        stored = await db.get(Account, enterprise.id)
        assert stored is not None
        stored.phone = "+639171234567"
        db.add(viewer)
        db.add(
            SupportTicket(
                request_code=f"REQ-T{uuid4().hex[:10]}",
                request_group="Account change",
                title="Change the contact number",
                description="Please update our contact number.",
                status="In Progress",
                enterprise_profile_id=enterprise.id,
                enterprise_name="Attachment Test change",
                requester_name="Test Manager change",
                change_field="contactNumber",
                change_value="+639179999999",
            )
        )
        await db.commit()

    # A fresh session, as in a real request: the enterprise's account is not loaded yet.
    async with postgres_runtime.sessions() as db:
        reader = await db.get(Account, viewer.id)
        assert reader is not None
        summaries = await list_requests(db, reader)

    change = next(
        summary.accountChange
        for summary in summaries
        if summary.enterpriseId == enterprise.enterprise_profile.enterprise_id  # type: ignore[union-attr]
    )
    assert change is not None
    assert change.currentValue == "+639171234567"
    assert change.requestedValue == "+639179999999"

    async with postgres_runtime.sessions() as db:
        await db.execute(delete(Account).where(Account.id == viewer.id))
        await db.commit()


async def _create_it_account(runtime: PostgresRuntime) -> Account:
    account = Account(
        id=str(uuid4()),
        email=f"tanaw-support-attachment-pg-it-{uuid4().hex[:12]}@example.com",
        password_hash="unused-test-password-hash",
        role=AccountRole.IT,
        display_name="IT Handler",
        title="IT Personnel",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
        password_changed_at=datetime.now(UTC),
    )
    async with runtime.sessions() as db:
        db.add(account)
        await db.commit()
    return account


@pytest.mark.asyncio
async def test_it_starts_on_a_request_once_and_lists_requests_by_enterprise(
    postgres_runtime: PostgresRuntime,
) -> None:
    enterprise = await _create_enterprise(postgres_runtime, label="handled")
    other = await _create_enterprise(postgres_runtime, label="elsewhere")
    it_account = await _create_it_account(postgres_runtime)
    slug = enterprise.enterprise_profile.enterprise_id  # type: ignore[union-attr]
    application = _create_test_app(postgres_runtime)
    transport = ASGITransport(app=application)

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        created = await client.post(
            "/operational/requests",
            headers=_authorization(enterprise),
            json={
                "group": "Other",
                "title": "Who handles this",
                "description": "A request that IT picks up with Start on it.",
            },
        )
        assert created.status_code == 201
        request_id = created.json()["id"]
        assert created.json()["handledBy"] is None

        started = await client.post(
            f"/operational/requests/{request_id}/start", headers=_authorization(it_account)
        )
        assert started.status_code == 200
        body = started.json()
        assert body["handledBy"] == {"accountId": it_account.id, "name": "IT Handler"}
        assert body["handledAt"] is not None
        assert body["messages"][-1]["message"] == "IT Handler started on it."

        again = await client.post(
            f"/operational/requests/{request_id}/start", headers=_authorization(it_account)
        )
        assert again.status_code == 409

        by_enterprise = await client.post(
            f"/operational/requests/{request_id}/start", headers=_authorization(enterprise)
        )
        assert by_enterprise.status_code == 403

        for value in (slug, enterprise.id):
            listed = await client.get(
                "/operational/requests",
                params={"enterpriseId": value},
                headers=_authorization(it_account),
            )
            assert listed.status_code == 200
            assert [item["id"] for item in listed.json()] == [request_id]
        elsewhere = await client.get(
            "/operational/requests",
            params={"enterpriseId": other.enterprise_profile.enterprise_id},  # type: ignore[union-attr]
            headers=_authorization(it_account),
        )
        assert elsewhere.json() == []
    # The module's cleanup removes the request, then the IT account (its email matches).
