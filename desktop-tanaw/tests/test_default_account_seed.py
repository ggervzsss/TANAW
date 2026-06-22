from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.core.security import verify_password
from app.features.accounts import seed
from app.features.accounts.models import Account, AccountRole, AccountStatus


class FakeSession:
    def __init__(self) -> None:
        self.added: list[Account] = []
        self.commit_count = 0

    def add(self, account: Account) -> None:
        self.added.append(account)

    async def commit(self) -> None:
        self.commit_count += 1


@pytest.mark.asyncio
async def test_default_account_accepts_configured_password_without_forced_change(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = Account(
        id="default-account",
        email="old-default@email.com",
        password_hash=seed.hash_password("Old1!"),
        role=AccountRole.IT,
        display_name=seed.DEFAULT_IT_DISPLAY_NAME,
        title="IT Personnel",
        status=AccountStatus.ACTIVE,
        must_change_password=True,
        temporary_password_created_at=datetime.now(UTC),
        temporary_password_expires_at=datetime.now(UTC) + timedelta(days=1),
        failed_login_attempts=2,
        locked_until=datetime.now(UTC) + timedelta(minutes=5),
    )
    session = FakeSession()

    async def get_default_account(_: object) -> Account:
        return account

    async def get_configured_account(_: object, __: str) -> None:
        return None

    monkeypatch.setattr(
        seed,
        "get_settings",
        lambda: SimpleNamespace(
            default_it_username="default@email.com",
            default_it_password="default",
        ),
    )
    monkeypatch.setattr(seed, "get_default_it_account", get_default_account)
    monkeypatch.setattr(seed, "get_account_by_email", get_configured_account)

    await seed.seed_default_it_account(session)  # type: ignore[arg-type]

    assert account.email == "default@email.com"
    assert verify_password("default", account.password_hash)
    assert account.must_change_password is False
    assert account.temporary_password_created_at is None
    assert account.temporary_password_expires_at is None
    assert account.failed_login_attempts == 0
    assert account.locked_until is None
    assert account.token_invalid_before is not None
    assert session.commit_count == 1


@pytest.mark.asyncio
async def test_new_default_account_is_created_without_forced_change(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()

    async def get_no_account(_: object, *args: str) -> None:
        return None

    monkeypatch.setattr(
        seed,
        "get_settings",
        lambda: SimpleNamespace(
            default_it_username="default@email.com",
            default_it_password="default",
        ),
    )
    monkeypatch.setattr(seed, "get_default_it_account", get_no_account)
    monkeypatch.setattr(seed, "get_account_by_email", get_no_account)

    await seed.seed_default_it_account(session)  # type: ignore[arg-type]

    account = session.added[0]
    assert account.email == "default@email.com"
    assert verify_password("default", account.password_hash)
    assert account.must_change_password is False
    assert account.role == AccountRole.IT
    assert account.status == AccountStatus.ACTIVE
    assert session.commit_count == 1
