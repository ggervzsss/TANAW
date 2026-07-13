from unittest.mock import AsyncMock, MagicMock

import pytest

from app.features.accounts import service
from app.features.accounts.models import AccountRole, DevDelivery


def test_delivery_records_do_not_have_a_channel_discriminator() -> None:
    assert "channel" not in DevDelivery.__table__.columns


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
