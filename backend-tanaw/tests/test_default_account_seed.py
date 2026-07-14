from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.security import hash_password, verify_password
from app.features.accounts import seed
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    SystemConfiguration,
)


def startup_account_settings(*, seed_development_accounts: bool = True) -> SimpleNamespace:
    return SimpleNamespace(
        bootstrap_it_username="default@email.com",
        bootstrap_it_password="default",
        seed_development_accounts=seed_development_accounts,
        development_admin_username="admin@email.com",
        development_admin_password="admin123",
        development_staff_username="staff@email.com",
        development_staff_password="staffstaff",
        development_it_username="it@email.com",
        development_it_password="it123456",
    )


def mock_session() -> MagicMock:
    db = MagicMock()
    db.execute = AsyncMock()
    db.flush = AsyncMock()
    db.commit = AsyncMock()
    return db


@pytest.mark.asyncio
async def test_fresh_database_creates_bootstrap_and_opt_in_development_accounts_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = mock_session()
    monkeypatch.setattr(seed, "get_settings", startup_account_settings)
    monkeypatch.setattr(seed, "get_seed_state", AsyncMock(return_value=None))
    monkeypatch.setattr(seed, "find_existing_it_account", AsyncMock(return_value=None))
    monkeypatch.setattr(seed, "get_account_by_email", AsyncMock(return_value=None))

    await seed.seed_default_accounts(db)

    added_accounts = [
        call.args[0] for call in db.add.call_args_list if isinstance(call.args[0], Account)
    ]
    accounts_by_email = {account.email: account for account in added_accounts}
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
    assert all(account.activated_at is not None for account in added_accounts)
    assert all(account.status == AccountStatus.ACTIVE for account in added_accounts)
    assert accounts_by_email["default@email.com"].is_protected_system_account is True
    assert all(
        not account.is_protected_system_account
        for email, account in accounts_by_email.items()
        if email != "default@email.com"
    )
    assert db.flush.await_count == 4
    db.commit.assert_awaited_once()

    states = [
        call.args[0]
        for call in db.add.call_args_list
        if isinstance(call.args[0], SystemConfiguration)
    ]
    assert {state.id for state in states} == {
        seed.BOOTSTRAP_STATE_ID,
        seed.DEVELOPMENT_STATE_ID,
    }


@pytest.mark.asyncio
async def test_existing_it_account_is_adopted_without_resetting_security_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    changed_at = datetime.now(UTC) - timedelta(days=2)
    account = Account(
        id="existing-bootstrap",
        email="renamed-it@tanaw.local",
        password_hash=hash_password("OwnerChanged2!Password"),
        role=AccountRole.IT,
        display_name="Renamed IT Owner",
        title="Custom title",
        status=AccountStatus.INACTIVE,
        activated_at=None,
        token_invalid_before=changed_at,
        failed_login_attempts=2,
        locked_until=changed_at,
    )
    original_values = (
        account.email,
        account.password_hash,
        account.role,
        account.title,
        account.status,
        account.activated_at,
        account.token_invalid_before,
        account.failed_login_attempts,
        account.locked_until,
    )
    db = mock_session()
    monkeypatch.setattr(
        seed,
        "get_settings",
        lambda: startup_account_settings(seed_development_accounts=False),
    )
    monkeypatch.setattr(seed, "get_seed_state", AsyncMock(return_value=None))
    monkeypatch.setattr(
        seed,
        "find_existing_it_account",
        AsyncMock(return_value=account),
    )

    await seed.seed_default_accounts(db)

    assert (
        account.email,
        account.password_hash,
        account.role,
        account.title,
        account.status,
        account.activated_at,
        account.token_invalid_before,
        account.failed_login_attempts,
        account.locked_until,
    ) == original_values
    assert verify_password("OwnerChanged2!Password", account.password_hash)
    assert account.is_protected_system_account is True
    db.flush.assert_not_awaited()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_initialized_bootstrap_is_never_synchronized_again(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    db = mock_session()
    state = SystemConfiguration(id=seed.BOOTSTRAP_STATE_ID, values_json="{}")
    monkeypatch.setattr(
        seed,
        "get_settings",
        lambda: startup_account_settings(seed_development_accounts=False),
    )
    monkeypatch.setattr(seed, "get_seed_state", AsyncMock(return_value=state))
    it_lookup = AsyncMock()
    monkeypatch.setattr(seed, "find_existing_it_account", it_lookup)

    await seed.seed_default_accounts(db)

    it_lookup.assert_not_awaited()
    db.add.assert_not_called()
    db.flush.assert_not_awaited()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_existing_development_accounts_keep_password_role_status_and_activation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    bootstrap_state = SystemConfiguration(id=seed.BOOTSTRAP_STATE_ID, values_json="{}")
    accounts = {
        "admin@email.com": Account(
            id="admin",
            email="admin@email.com",
            password_hash=hash_password("ChangedAdmin2!"),
            role=AccountRole.STAFF,
            display_name="Renamed Admin",
            title="Changed",
            status=AccountStatus.INACTIVE,
            activated_at=None,
        ),
        "staff@email.com": Account(
            id="staff",
            email="staff@email.com",
            password_hash=hash_password("ChangedStaff2!"),
            role=AccountRole.STAFF,
            display_name="Changed Staff",
            title="Changed",
            status=AccountStatus.INACTIVE,
            activated_at=None,
        ),
        "it@email.com": Account(
            id="it",
            email="it@email.com",
            password_hash=hash_password("ChangedIt2!"),
            role=AccountRole.IT,
            display_name="Changed IT",
            title="Changed",
            status=AccountStatus.INACTIVE,
            activated_at=None,
        ),
    }
    snapshots = {
        email: (
            account.password_hash,
            account.role,
            account.display_name,
            account.title,
            account.status,
            account.activated_at,
        )
        for email, account in accounts.items()
    }
    db = mock_session()
    monkeypatch.setattr(seed, "get_settings", startup_account_settings)
    monkeypatch.setattr(
        seed,
        "get_seed_state",
        AsyncMock(side_effect=[bootstrap_state, None]),
    )
    monkeypatch.setattr(
        seed,
        "get_account_by_email",
        AsyncMock(side_effect=lambda _, email: accounts.get(email)),
    )

    await seed.seed_default_accounts(db)

    for email, account in accounts.items():
        assert (
            account.password_hash,
            account.role,
            account.display_name,
            account.title,
            account.status,
            account.activated_at,
        ) == snapshots[email]
    db.flush.assert_not_awaited()
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_bootstrap_credentials_are_required_only_for_a_fresh_database(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = startup_account_settings(seed_development_accounts=False)
    settings.bootstrap_it_username = None
    settings.bootstrap_it_password = None
    db = mock_session()
    monkeypatch.setattr(seed, "get_settings", lambda: settings)
    monkeypatch.setattr(seed, "get_seed_state", AsyncMock(return_value=None))
    monkeypatch.setattr(seed, "find_existing_it_account", AsyncMock(return_value=None))

    with pytest.raises(RuntimeError, match="one-time bootstrap"):
        await seed.seed_default_accounts(db)

    db.commit.assert_not_awaited()
