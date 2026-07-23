from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
)
from app.features.auth.router import create_support_request
from app.features.auth.schemas import SupportRequest
from app.features.operational.models import OperationalAlert, SupportTicket
from app.features.operational.router import (
    create_ticket_message,
    support_ticket_notification_roles,
)
from app.features.operational.schemas import (
    SupportTicketCreate,
    SupportTicketDetail,
    SupportTicketMessageCreate,
)
from app.features.operational.service import (
    ResolvedTicketConversationError,
    create_support_ticket_message,
    list_support_tickets,
    list_user_notifications,
)


def _account(*, role: AccountRole) -> Account:
    account = Account(
        id=f"{role.value}-account",
        email=f"{role.value}@example.com",
        password_hash="hash",
        role=role,
        display_name=f"{role.value.title()} User",
        title=role.value.title(),
        status=AccountStatus.ACTIVE,
    )
    if role == AccountRole.ENTERPRISE:
        account.enterprise_profile = EnterpriseProfile(
            account_id=account.id,
            enterprise_id="ENT-001",
            enterprise_name="Test Enterprise",
            category="business",
            manager_name="Test Manager",
            barangay="Poblacion",
        )
    return account


def test_support_ticket_escalation_depends_on_priority() -> None:
    assert support_ticket_notification_roles("Urgent") == [
        AccountRole.ADMIN,
        AccountRole.IT,
    ]
    assert support_ticket_notification_roles("Normal") == [AccountRole.IT]


def test_support_ticket_requires_a_non_whitespace_affected_area() -> None:
    with pytest.raises(ValidationError):
        SupportTicketCreate(
            category="Other",
            priority="Normal",
            subject="Account issue",
            affectedArea="   ",
            description="The account page is not loading.",
        )


@pytest.mark.asyncio
async def test_staff_notification_query_keeps_only_report_submissions() -> None:
    db = MagicMock()
    db.scalars = AsyncMock(return_value=[])

    assert await list_user_notifications(db, _account(role=AccountRole.STAFF)) == []

    statement = db.scalars.await_args.args[0]
    sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
    assert "user_notifications.source_type = 'enterprise.report'" in sql
    assert "Enterprise Report Submitted" in sql
    assert "Enterprise Report Resubmitted" in sql


@pytest.mark.asyncio
async def test_admin_support_view_keeps_only_high_and_urgent_requests() -> None:
    db = MagicMock()
    scalar_result = MagicMock()
    scalar_result.all.return_value = []
    db.scalars = AsyncMock(return_value=scalar_result)

    assert await list_support_tickets(db, _account(role=AccountRole.ADMIN)) == []

    statement = db.scalars.await_args.args[0]
    sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
    assert "'High'" in sql
    assert "'Urgent'" in sql


@pytest.mark.asyncio
async def test_login_support_request_exposes_contact_and_notifies_portal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    alert = OperationalAlert(
        id="alert-id",
        alert_code="ALT-000001",
        alert_type="Maintenance Request",
        severity="Warning",
        requester="Requester <requester@example.com>",
        summary="Unable to sign in to TANAW.",
        required_action="Contact requester@example.com.",
        resolution_mode="Remote Review",
        owner="IT",
        status="New",
        created_at=datetime.now(UTC),
    )
    create_alert = AsyncMock(return_value=alert)
    create_notifications = AsyncMock(return_value=[])
    monkeypatch.setattr("app.features.auth.router.create_operational_alert", create_alert)
    monkeypatch.setattr("app.features.auth.router.create_role_notifications", create_notifications)

    result = await create_support_request(
        SupportRequest(
            name="  Requester  ",
            email="Requester@Example.com",
            message="  Unable to sign in to TANAW.  ",
        ),
        MagicMock(),
    )

    assert result.status == "ok"
    create_alert.assert_awaited_once()
    alert_call = create_alert.await_args
    assert alert_call is not None
    alert_kwargs = alert_call.kwargs
    assert alert_kwargs["requester"] == "Requester <requester@example.com>"
    assert alert_kwargs["required_action"].endswith("requester@example.com.")
    assert alert_kwargs["source_id"].startswith("login-support:")
    create_notifications.assert_awaited_once()


@pytest.mark.asyncio
async def test_it_reply_moves_an_open_ticket_to_in_review(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = _account(role=AccountRole.IT)
    ticket = SupportTicket(
        id="ticket-id",
        ticket_code="TCK-000001",
        enterprise_profile_id="enterprise-account",
        enterprise_name="Test Enterprise",
        category="Other",
        priority="Normal",
        subject="Support request",
        description="Support request description",
        status="Open",
    )
    detail = MagicMock(spec=SupportTicketDetail)
    get_detail = AsyncMock(return_value=detail)
    monkeypatch.setattr("app.features.operational.service.get_support_ticket_detail", get_detail)
    db = MagicMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    result = await create_support_ticket_message(
        db,
        ticket,
        account,
        SupportTicketMessageCreate(message="A follow-up support message."),
    )

    assert result is detail
    assert ticket.status == "In Review"
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_resolved_ticket_rejects_reply_before_persistence() -> None:
    account = _account(role=AccountRole.ENTERPRISE)
    ticket = SupportTicket(
        id="ticket-id",
        ticket_code="TCK-000001",
        enterprise_profile_id=account.id,
        enterprise_name="Test Enterprise",
        category="Other",
        priority="Normal",
        subject="Support request",
        description="Support request description",
        status="Resolved",
    )
    db = MagicMock()
    db.add = MagicMock()
    db.commit = AsyncMock()

    with pytest.raises(ResolvedTicketConversationError):
        await create_support_ticket_message(
            db,
            ticket,
            account,
            SupportTicketMessageCreate(message="A late follow-up message."),
        )

    db.add.assert_not_called()
    db.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolved_ticket_endpoint_returns_structured_conflict(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = _account(role=AccountRole.ENTERPRISE)
    ticket = SupportTicket(
        id="ticket-id",
        ticket_code="TCK-000001",
        enterprise_profile_id=account.id,
        enterprise_name="Test Enterprise",
        category="Other",
        priority="Normal",
        subject="Support request",
        description="Support request description",
        status="Resolved",
    )
    get_ticket = AsyncMock(return_value=ticket)
    monkeypatch.setattr(
        "app.features.operational.router.get_support_ticket_for_account",
        get_ticket,
    )
    db = MagicMock()
    db.add = MagicMock()
    db.rollback = AsyncMock()

    with pytest.raises(HTTPException) as raised:
        await create_ticket_message(
            ticket.id,
            SupportTicketMessageCreate(message="A late follow-up message."),
            account,
            db,
        )

    assert raised.value.status_code == 409
    assert raised.value.detail == {
        "code": "ticket_resolved",
        "message": "This ticket is resolved. The conversation is now closed.",
    }
    get_ticket.assert_awaited_once_with(db, account, ticket.id, for_update=True)
    db.add.assert_not_called()
    db.rollback.assert_awaited_once()
