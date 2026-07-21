from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
)
from app.features.auth.router import create_support_request
from app.features.auth.schemas import SupportRequest
from app.features.operational.models import OperationalAlert, SupportTicket
from app.features.operational.router import support_ticket_notification_roles
from app.features.operational.schemas import SupportTicketDetail, SupportTicketMessageCreate
from app.features.operational.service import (
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
    broadcast = AsyncMock()
    monkeypatch.setattr("app.features.auth.router.create_operational_alert", create_alert)
    monkeypatch.setattr("app.features.auth.router.create_role_notifications", create_notifications)
    monkeypatch.setattr("app.features.auth.router.operational_ws_manager.broadcast", broadcast)

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
    broadcast.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("role", "initial_status", "expected_status"),
    [
        (AccountRole.ENTERPRISE, "Resolved", "Open"),
        (AccountRole.IT, "Open", "In Review"),
    ],
)
async def test_ticket_messages_apply_role_appropriate_status(
    monkeypatch: pytest.MonkeyPatch,
    role: AccountRole,
    initial_status: str,
    expected_status: str,
) -> None:
    account = _account(role=role)
    ticket = SupportTicket(
        id="ticket-id",
        ticket_code="TCK-000001",
        enterprise_profile_id="enterprise-account",
        enterprise_name="Test Enterprise",
        category="Other",
        priority="Normal",
        subject="Support request",
        description="Support request description",
        status=initial_status,
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
    assert ticket.status == expected_status
    db.commit.assert_awaited_once()
