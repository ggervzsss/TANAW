from datetime import UTC, datetime
from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.notifications import router
from app.features.notifications.schemas import EnterpriseNotificationCreate

NOW = datetime(2026, 11, 26, 4, tzinfo=UTC)


def account(role: AccountRole) -> Account:
    record = Account(
        id=f"{role.value}-account",
        email=f"{role.value}@example.com",
        password_hash="hash",
        role=role,
        display_name=f"{role.value.title()} User",
        title=role.value,
        status=AccountStatus.ACTIVE,
        activated_at=NOW,
    )
    if role == AccountRole.ENTERPRISE:
        profile = EnterpriseProfile(
            account_id=record.id,
            enterprise_id="ENT-001",
            enterprise_name="Sampaguita Gardens",
            attraction_code="411",
            manager_name="Test Manager",
            barangay="Poblacion",
        )
        record.enterprise_profile = profile
    return record


async def send(
    monkeypatch: pytest.MonkeyPatch, sender: Account, **payload: object
) -> tuple[AsyncMock, AsyncMock]:
    notify = AsyncMock(return_value=MagicMock(id="notification-1"))
    log = AsyncMock()
    monkeypatch.setattr(
        router,
        "get_enterprise_notification_recipient",
        AsyncMock(return_value=account(AccountRole.ENTERPRISE)),
    )
    monkeypatch.setattr(router, "create_user_notification", notify)
    monkeypatch.setattr(router, "create_activity_log", log)
    await router.create_enterprise_notification(
        EnterpriseNotificationCreate.model_validate(
            {"enterpriseId": "ENT-001", "title": "Check", "message": "Please check.", **payload}
        ),
        sender,
        cast(AsyncSession, MagicMock()),
    )
    return notify, log


@pytest.mark.asyncio
async def test_it_sends_an_info_notice_recorded_under_enterprises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    notify, log = await send(monkeypatch, account(AccountRole.IT))

    assert notify.await_args is not None and log.await_args is not None
    assert notify.await_args.kwargs["notification_type"] == "IT Notice"
    assert notify.await_args.kwargs["severity"] == "Info"
    entry = log.await_args.args[1]
    assert (entry.group, entry.actorRole) == ("Enterprises", "IT Personnel")


@pytest.mark.asyncio
async def test_staff_follow_ups_keep_their_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    notify, log = await send(monkeypatch, account(AccountRole.STAFF))

    assert notify.await_args is not None and log.await_args is not None
    assert notify.await_args.kwargs["notification_type"] == "Staff Follow-up"
    assert notify.await_args.kwargs["severity"] == "Warning"
    entry = log.await_args.args[1]
    assert (entry.group, entry.actorRole) == ("Reports", "LGU Staff")


@pytest.mark.asyncio
async def test_a_chosen_type_and_severity_are_kept(monkeypatch: pytest.MonkeyPatch) -> None:
    notify, _ = await send(
        monkeypatch, account(AccountRole.IT), type="Camera Check", severity="Warning"
    )

    assert notify.await_args is not None
    assert notify.await_args.kwargs["notification_type"] == "Camera Check"
    assert notify.await_args.kwargs["severity"] == "Warning"
