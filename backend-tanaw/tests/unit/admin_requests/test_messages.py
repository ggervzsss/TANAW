from collections.abc import AsyncIterator, Mapping
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

from app.db.session import get_db
from app.features.accounts.dependencies import get_current_account
from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.activity_logs.schemas import ActivityLogCreate, ActivityLogSummary
from app.features.activity_logs.service import can_role_view_log
from app.features.admin_requests import router as admin_requests_router
from app.features.admin_requests import service as admin_requests_service
from app.features.admin_requests.router import create_admin_request_message
from app.features.admin_requests.schemas import AdminRequestMessageCreate
from app.features.admin_requests.service import (
    RequestSource,
    bounded,
    find_request_source,
    send_admin_request_message,
)
from app.features.monitoring.models import OperationalAlert
from app.features.support.models import SupportTicket


def _account(role: AccountRole) -> Account:
    account = Account(
        id=f"{role.value}-account",
        email=f"{role.value}@example.com",
        password_hash="hash",
        role=role,
        display_name="LGU Admin" if role == AccountRole.ADMIN else f"{role.value.title()} User",
        title=role.value.title(),
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
    )
    if role == AccountRole.ENTERPRISE:
        account.enterprise_profile = EnterpriseProfile(
            account_id=account.id,
            enterprise_id="ENT-001",
            enterprise_name="San Pedro Plaza",
            attraction_code="411",
            manager_name="Maria Santos",
            barangay="Poblacion",
        )
    return account


def _alert(owner: str) -> OperationalAlert:
    return OperationalAlert(
        id="alert-internal-id",
        alert_code="ALT-000007",
        alert_type="Foot Traffic Alert",
        severity="Warning",
        requester="San Pedro Plaza",
        enterprise="San Pedro Plaza",
        summary="San Pedro Plaza is busier than usual.",
        required_action="Review the live map.",
        resolution_mode="Admin Monitoring",
        owner=owner,
        status="New",
        created_at=datetime.now(UTC),
    )


def _ticket() -> SupportTicket:
    return SupportTicket(
        id="ticket-id",
        ticket_code="TCK-000123",
        enterprise_profile_id="enterprise-account",
        enterprise_name="San Pedro Plaza",
        category="Camera Issue",
        priority="Urgent",
        subject="Entrance camera is offline",
        description="The entrance camera stopped counting.",
        status="Open",
    )


def _activity(payload: ActivityLogCreate) -> ActivityLogSummary:
    return ActivityLogSummary(
        id="log-1",
        timestamp=datetime.now(UTC),
        category=payload.category,
        severity=payload.severity,
        actor=payload.actor,
        actorRole=payload.actorRole,
        action=payload.action,
        target=payload.target,
        summary=payload.summary,
        sourceId=payload.sourceId,
        metadata=payload.metadata,
    )


def test_message_is_trimmed_and_bounded() -> None:
    payload = AdminRequestMessageCreate(
        sourceType="support.ticket",
        sourceId="  ticket-id  ",
        message="  Please call the enterprise.  ",
    )
    assert payload.sourceId == "ticket-id"
    assert payload.message == "Please call the enterprise."

    for message in ("", "   \n  ", "x" * 1001):
        with pytest.raises(ValidationError):
            AdminRequestMessageCreate(
                sourceType="support.ticket", sourceId="ticket-id", message=message
            )

    assert (
        len(
            AdminRequestMessageCreate(
                sourceType="support.ticket", sourceId="ticket-id", message="x" * 1000
            ).message
        )
        == 1000
    )


def test_message_rejects_unknown_source_type() -> None:
    with pytest.raises(ValidationError):
        AdminRequestMessageCreate(
            sourceType="support.message",  # type: ignore[arg-type]
            sourceId="ticket-id",
            message="Please check this.",
        )


def test_bounded_keeps_short_text_and_marks_cut_text() -> None:
    assert bounded("TCK-000123", 160) == "TCK-000123"
    shortened = bounded("x" * 200, 160)
    assert len(shortened) == 160
    assert shortened.endswith("…")


@pytest.mark.asyncio
async def test_admin_visible_alert_resolves_by_its_code() -> None:
    db = MagicMock()
    db.scalar = AsyncMock(return_value=_alert("Admin"))

    source = await find_request_source(
        db, _account(AccountRole.ADMIN), "operational.alert", "ALT-000007"
    )

    assert source == RequestSource(
        source_type="operational.alert",
        source_id="ALT-000007",
        reference="ALT-000007",
        description="ALT-000007",
    )
    statement = db.scalar.await_args.args[0]
    sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
    assert "operational_alerts.alert_code = 'ALT-000007'" in sql


@pytest.mark.asyncio
@pytest.mark.parametrize("alert", [None, _alert("IT")])
async def test_missing_or_it_only_alert_is_not_found(alert: OperationalAlert | None) -> None:
    db = MagicMock()
    db.scalar = AsyncMock(return_value=alert)

    assert (
        await find_request_source(
            db, _account(AccountRole.ADMIN), "operational.alert", "ALT-000007"
        )
        is None
    )


@pytest.mark.asyncio
async def test_ticket_source_uses_the_admin_ticket_visibility(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    admin = _account(AccountRole.ADMIN)
    get_ticket = AsyncMock(return_value=_ticket())
    monkeypatch.setattr(admin_requests_service, "get_support_ticket_for_account", get_ticket)
    db = MagicMock()

    source = await find_request_source(db, admin, "support.ticket", "ticket-id")

    assert source is not None
    assert source.source_id == "ticket-id"
    assert source.reference == "TCK-000123"
    get_ticket.assert_awaited_once_with(db, admin, "ticket-id")

    get_ticket.return_value = None
    assert await find_request_source(db, admin, "support.ticket", "ticket-id") is None


@pytest.mark.asyncio
async def test_profile_source_needs_a_pending_change_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    enterprise = _account(AccountRole.ENTERPRISE)
    summary = MagicMock()
    summary.profileChangeRequests = [MagicMock()]
    monkeypatch.setattr(
        admin_requests_service, "get_account_by_id", AsyncMock(return_value=enterprise)
    )
    to_summary = AsyncMock(return_value=summary)
    monkeypatch.setattr(admin_requests_service, "to_account_summary_with_requests", to_summary)
    admin = _account(AccountRole.ADMIN)

    source = await find_request_source(MagicMock(), admin, "enterprise.profile", enterprise.id)

    assert source == RequestSource(
        source_type="enterprise.profile",
        source_id=enterprise.id,
        reference="San Pedro Plaza",
        description="San Pedro Plaza's profile change request",
    )

    summary.profileChangeRequests = []
    assert (
        await find_request_source(MagicMock(), admin, "enterprise.profile", enterprise.id) is None
    )


@pytest.mark.asyncio
async def test_profile_source_ignores_non_enterprise_accounts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        admin_requests_service,
        "get_account_by_id",
        AsyncMock(return_value=_account(AccountRole.STAFF)),
    )

    assert (
        await find_request_source(
            MagicMock(), _account(AccountRole.ADMIN), "enterprise.profile", "staff-account"
        )
        is None
    )


@pytest.mark.asyncio
async def test_message_notifies_it_and_records_admin_activity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    notify = AsyncMock(return_value=[MagicMock(), MagicMock()])
    monkeypatch.setattr(admin_requests_service, "create_role_notifications", notify)
    record = AsyncMock(side_effect=lambda _db, payload: _activity(payload))
    monkeypatch.setattr(admin_requests_service, "create_activity_log", record)
    admin = _account(AccountRole.ADMIN)
    db = MagicMock()
    source = RequestSource(
        source_type="support.ticket",
        source_id="ticket-id",
        reference="TCK-000123",
        description="TCK-000123",
    )

    result = await send_admin_request_message(db, admin, source, "Please call the enterprise.")

    notify_call = notify.await_args
    assert notify_call is not None
    notify_kwargs: Mapping[str, Any] = notify_call.kwargs
    assert notify_kwargs["recipient_roles"] == [AccountRole.IT]
    assert notify_kwargs["source_type"] == "support.ticket"
    assert notify_kwargs["source_id"] == "ticket-id"
    assert notify_kwargs["message"] == "Please call the enterprise."
    assert notify_kwargs["title"] == "LGU Admin sent a message about TCK-000123."
    assert notify_kwargs["actor"] is admin
    assert notify_kwargs.get("replace_existing_for_source", False) is False

    record_call = record.await_args
    assert record_call is not None
    log: ActivityLogCreate = record_call.args[1]
    assert log.category == "Admin Operation"
    assert log.action == "Message IT"
    assert log.actorRole == "Admin"
    assert log.target == "TCK-000123"
    assert log.sourceId == "ticket-id"
    assert log.metadata == {
        "sourceType": "support.ticket",
        "message": "Please call the enterprise.",
        "recipientCount": 2,
    }
    assert result.recipientCount == 2
    assert result.activity.action == "Message IT"
    # The message is not written as a ticket reply the enterprise could read.
    db.add.assert_not_called()


def test_admin_can_read_the_message_activity() -> None:
    log = _activity(
        ActivityLogCreate(
            category="Admin Operation",
            severity="Info",
            actor="LGU Admin",
            actorRole="Admin",
            action="Message IT",
            target="TCK-000123",
            summary="LGU Admin sent IT a message about TCK-000123.",
            sourceId="ticket-id",
        )
    )
    assert can_role_view_log(AccountRole.ADMIN.value, log)


@pytest.mark.asyncio
async def test_endpoint_returns_not_found_for_an_unknown_request(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(admin_requests_router, "find_request_source", AsyncMock(return_value=None))
    send = AsyncMock()
    monkeypatch.setattr(admin_requests_router, "send_admin_request_message", send)

    with pytest.raises(HTTPException) as raised:
        await create_admin_request_message(
            AdminRequestMessageCreate(
                sourceType="operational.alert", sourceId="ALT-404", message="Please check."
            ),
            _account(AccountRole.ADMIN),
            MagicMock(),
        )

    assert raised.value.status_code == 404
    assert raised.value.detail == "Request not found."
    send.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [AccountRole.IT, AccountRole.STAFF, AccountRole.ENTERPRISE])
async def test_only_admins_can_message_it(role: AccountRole) -> None:
    application = FastAPI()
    application.include_router(admin_requests_router.router)

    async def current_account() -> Account:
        return _account(role)

    async def test_db() -> AsyncIterator[MagicMock]:
        yield MagicMock()

    application.dependency_overrides[get_current_account] = current_account
    application.dependency_overrides[get_db] = test_db

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://testserver"
    ) as client:
        response = await client.post(
            "/operational/requests/messages",
            json={"sourceType": "support.ticket", "sourceId": "ticket-id", "message": "Hi"},
        )

    assert response.status_code == 403
