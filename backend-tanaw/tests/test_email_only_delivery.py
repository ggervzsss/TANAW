from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.features.accounts import router as account_router
from app.features.accounts import service
from app.features.accounts.models import AccountRole
from app.features.mail.dev_log import (
    clear_dev_deliveries,
    get_dev_delivery,
    list_dev_deliveries,
    record_dev_delivery,
)


def test_dev_log_is_ephemeral_and_not_available_in_production(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    clear_dev_deliveries()
    delivery = record_dev_delivery(
        account_id="account-1",
        recipient="developer@example.com",
        subject="Development message",
        body="Rendered email body",
        status="recorded",
        created_at=datetime.now(UTC),
    )

    assert list_dev_deliveries() == [delivery]
    assert get_dev_delivery(delivery.id) == delivery

    monkeypatch.setattr(
        account_router,
        "get_settings",
        lambda: SimpleNamespace(is_production=True),
    )
    with pytest.raises(HTTPException) as exc_info:
        account_router.ensure_dev_log_available()
    assert exc_info.value.status_code == 404
    clear_dev_deliveries()


@pytest.mark.asyncio
async def test_account_phone_is_preserved_without_creating_an_sms_delivery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    issue_account_activation = AsyncMock()
    monkeypatch.setattr(service, "issue_account_activation", issue_account_activation)
    db = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    account = await service.create_account_with_activation(
        db,
        email="user@example.com",
        phone="+639171234567",
        role=AccountRole.STAFF,
        display_name="Test User",
        title="LGU Staff",
    )

    assert account.phone == "+639171234567"
    assert account.activated_at is None
    issue_account_activation.assert_awaited_once_with(db, account, lock_account=False)
    assert db.add.call_count == 1
