from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.service import get_account_preferences
from app.features.auth.schemas import AccountPreferences
from app.features.auth.settings_router import get_preferences, update_preferences


def make_account(account_id: str, preferences_json: str | None = None) -> Account:
    return Account(
        id=account_id,
        email=f"{account_id}@example.com",
        password_hash="hash",
        role=AccountRole.STAFF,
        display_name=account_id,
        title="Staff",
        status=AccountStatus.ACTIVE,
        preferences_json=preferences_json,
    )


@pytest.mark.asyncio
async def test_display_preferences_default_and_partial_update_preserve_theme() -> None:
    account = make_account("account-a", '{"theme": "dark"}')
    db = AsyncMock()

    before = await get_preferences(account)
    updated = await update_preferences(AccountPreferences(textSize="large"), account, db)

    assert before == AccountPreferences(theme="dark")
    assert updated == AccountPreferences(theme="dark", textSize="large", interfaceScale="default")
    assert get_account_preferences(account) == {"theme": "dark", "textSize": "large"}
    db.flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_display_preferences_are_isolated_by_account() -> None:
    account_a = make_account("account-a")
    account_b = make_account("account-b")
    db = AsyncMock()

    await update_preferences(
        AccountPreferences(textSize="extra-large", interfaceScale="comfortable"),
        account_a,
        db,
    )

    assert await get_preferences(account_a) == AccountPreferences(
        textSize="extra-large", interfaceScale="comfortable"
    )
    assert await get_preferences(account_b) == AccountPreferences()


@pytest.mark.parametrize(
    ("field", "value"),
    [("textSize", "huge"), ("interfaceScale", "zoomed")],
)
def test_display_preferences_reject_unknown_presets(field: str, value: str) -> None:
    with pytest.raises(ValidationError):
        AccountPreferences.model_validate({field: value})
