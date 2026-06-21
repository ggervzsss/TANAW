from datetime import UTC, datetime, timedelta

import pytest

from app.core.password_policy import PASSWORD_POLICY_MESSAGE, validate_password_policy
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.auth.service import (
    LOGIN_ATTEMPT_LIMIT,
    clear_login_failures,
    lockout_seconds_remaining,
    register_failed_login,
)


def test_password_policy_requires_character_classes() -> None:
    with pytest.raises(ValueError, match=PASSWORD_POLICY_MESSAGE):
        validate_password_policy("Aa1!b")

    with pytest.raises(ValueError, match=PASSWORD_POLICY_MESSAGE):
        validate_password_policy("abcdef")

    assert validate_password_policy("Aa1!bc") == "Aa1!bc"


def test_third_failed_login_locks_account_for_five_minutes() -> None:
    account = _account()
    now = datetime(2026, 6, 21, tzinfo=UTC)

    for _ in range(LOGIN_ATTEMPT_LIMIT - 1):
        assert register_failed_login(account, now) == 0

    assert register_failed_login(account, now) == 300
    assert lockout_seconds_remaining(account, now + timedelta(minutes=4)) == 60

    clear_login_failures(account)
    assert lockout_seconds_remaining(account, now) == 0
    assert account.failed_login_attempts == 0


def _account() -> Account:
    return Account(
        email="user@example.com",
        password_hash="unused",
        role=AccountRole.IT,
        display_name="Test User",
        title="IT Personnel",
        status=AccountStatus.ACTIVE,
    )
