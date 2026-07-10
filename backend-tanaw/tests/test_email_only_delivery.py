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
    deliver_email = AsyncMock()
    monkeypatch.setattr(service, "deliver_email", deliver_email)
    db = MagicMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    account = await service.create_account_with_temporary_password(
        db,
        email="user@example.com",
        phone="+639171234567",
        role=AccountRole.STAFF,
        display_name="Test User",
        title="LGU Staff",
    )

    assert account.phone == "+639171234567"
    deliver_email.assert_awaited_once()
    delivery_call = deliver_email.await_args
    assert delivery_call is not None
    assert delivery_call.kwargs["recipient"] == "user@example.com"
    assert db.add.call_count == 1
