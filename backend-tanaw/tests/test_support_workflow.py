from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.auth.router import create_support_request
from app.features.auth.schemas import SupportRequest
from app.features.operational.models import OperationalAlert, SupportTicket
from app.features.operational.schemas import SupportTicketDetail, SupportTicketMessageCreate
from app.features.operational.service import create_support_ticket_message


def _account(*, role: AccountRole) -> Account:
    return Account(
        id=f"{role.value}-account",
        email=f"{role.value}@example.com",
        password_hash="hash",
        role=role,
        display_name=f"{role.value.title()} User",
        title=role.value.title(),
        status=AccountStatus.ACTIVE,
        enterprise_id="ENT-001" if role == AccountRole.ENTERPRISE else None,
        enterprise_name="Test Enterprise" if role == AccountRole.ENTERPRISE else None,
    )


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
        enterprise_account_id="enterprise-account",
        enterprise_id="ENT-001",
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
