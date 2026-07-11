from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from app.core.security import verify_password
from app.features.accounts import seed
from app.features.accounts.defaults import DEFAULT_IT_DISPLAY_NAME
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
        display_name=DEFAULT_IT_DISPLAY_NAME,
        title="IT Personnel",
        status=AccountStatus.ACTIVE,
        activated_at=None,
        failed_login_attempts=2,
        locked_until=datetime.now(UTC) + timedelta(minutes=5),
    )
    session = FakeSession()

    async def get_seeded_account(_: object, spec: object) -> Account | None:
        return account if getattr(spec, "username_setting", None) == "DEFAULT_IT_USERNAME" else None

    async def get_configured_account(_: object, __: str) -> None:
        return None

    monkeypatch.setattr(seed, "get_settings", default_account_settings)
    monkeypatch.setattr(seed, "get_seeded_account", get_seeded_account)
    monkeypatch.setattr(seed, "get_account_by_email", get_configured_account)

    await seed.seed_default_accounts(session)  # type: ignore[arg-type]

    assert account.email == "default@email.com"
    assert verify_password("default", account.password_hash)
    assert account.activated_at is not None
    assert account.failed_login_attempts == 0
    assert account.locked_until is None
    assert account.token_invalid_before is not None
    assert {seeded.email for seeded in session.added} == {
        "admin@email.com",
        "staff@email.com",
        "it@email.com",
    }
    assert session.commit_count == 1


@pytest.mark.asyncio
async def test_new_default_accounts_are_created_without_forced_change(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()

    async def get_no_account(_: object, *args: object) -> None:
        return None

    monkeypatch.setattr(seed, "get_settings", default_account_settings)
    monkeypatch.setattr(seed, "get_seeded_account", get_no_account)
    monkeypatch.setattr(seed, "get_account_by_email", get_no_account)

    await seed.seed_default_accounts(session)  # type: ignore[arg-type]

    accounts_by_email = {account.email: account for account in session.added}
    assert set(accounts_by_email) == {
        "default@email.com",
        "admin@email.com",
        "staff@email.com",
        "it@email.com",
    }
    assert verify_password("default", accounts_by_email["default@email.com"].password_hash)
    assert verify_password("admin123", accounts_by_email["admin@email.com"].password_hash)
    assert verify_password("staffstaff", accounts_by_email["staff@email.com"].password_hash)
    assert verify_password("it123456", accounts_by_email["it@email.com"].password_hash)
    assert accounts_by_email["default@email.com"].role == AccountRole.IT
    assert accounts_by_email["admin@email.com"].role == AccountRole.ADMIN
    assert accounts_by_email["staff@email.com"].role == AccountRole.STAFF
    assert accounts_by_email["it@email.com"].role == AccountRole.IT
    assert accounts_by_email["admin@email.com"].display_name == "LGU Admin"
    assert accounts_by_email["staff@email.com"].display_name == "LGU Staff"
    assert accounts_by_email["it@email.com"].display_name == "IT Personnel"
    assert all("Temporary" not in account.display_name for account in session.added)
    assert all(account.activated_at is not None for account in session.added)
    assert all(account.status == AccountStatus.ACTIVE for account in session.added)
    assert session.commit_count == 1


def default_account_settings() -> SimpleNamespace:
    return SimpleNamespace(
        default_it_username="default@email.com",
        default_it_password="default",
        temporary_admin_username="admin@email.com",
        temporary_admin_password="admin123",
        temporary_staff_username="staff@email.com",
        temporary_staff_password="staffstaff",
        temporary_it_username="it@email.com",
        temporary_it_password="it123456",
    )
