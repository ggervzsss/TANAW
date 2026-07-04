from datetime import UTC, datetime, timedelta

import pytest

from app.core.config import Settings
from app.core.password_policy import PASSWORD_POLICY_MESSAGE, validate_password_policy
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.schemas import PasswordChangeRequest
from app.features.accounts.service import generate_temporary_password
from app.features.auth.schemas import ForgotPasswordResetRequest
from app.features.auth.service import (
    LOGIN_ATTEMPT_LIMIT,
    LOGIN_LOCK_MINUTES,
    LoginLockoutPolicy,
    clear_login_failures,
    lockout_seconds_remaining,
    login_lockout_message,
    register_failed_login,
    resolve_login_lockout_policy,
)


def test_password_policy_requires_character_classes() -> None:
    invalid_passwords = (
        "Aa1!b",
        "abcdef!",
        "ABCDEF1!",
        "Abcdef!",
        "Abcdef1",
        "Abc1 d",
        "Abc١!d",
    )
    for password in invalid_passwords:
        with pytest.raises(ValueError, match=PASSWORD_POLICY_MESSAGE):
            validate_password_policy(password)

    assert validate_password_policy("Aa1!bc") == "Aa1!bc"


def test_password_policy_accepts_long_and_unicode_passwords_consistently() -> None:
    long_password = f"Aa1!{'b' * 200}"

    assert validate_password_policy(long_password) == long_password
    assert validate_password_policy("Aa1!😀b") == "Aa1!😀b"
    assert (
        PasswordChangeRequest(currentPassword="temporary", newPassword=long_password).newPassword
        == long_password
    )
    assert (
        ForgotPasswordResetRequest(
            challengeId="challenge",
            resetToken="token",
            newPassword=long_password,
        ).newPassword
        == long_password
    )


def test_generated_passwords_follow_policy() -> None:
    for _ in range(20):
        temporary_password = generate_temporary_password()
        assert validate_password_policy(temporary_password) == temporary_password


def test_default_account_credentials_are_not_subject_to_the_user_password_policy() -> None:
    settings = Settings(
        default_it_username="default@email.com",
        default_it_password="default",
        temporary_admin_username="admin@email.com",
        temporary_admin_password="admin123",
        temporary_staff_username="staff@email.com",
        temporary_staff_password="staffstaff",
        temporary_it_username="it@email.com",
        temporary_it_password="it123456",
    )

    assert settings.default_it_password == "default"
    assert settings.temporary_admin_password == "admin123"
    assert settings.temporary_staff_password == "staffstaff"
    assert settings.temporary_it_password == "it123456"


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


def test_custom_login_lockout_policy_controls_attempts_and_duration() -> None:
    account = _account()
    now = datetime(2026, 6, 21, tzinfo=UTC)
    policy = LoginLockoutPolicy(attempt_limit=5, lock_minutes=15)

    for _ in range(policy.attempt_limit - 1):
        assert register_failed_login(account, now, policy=policy) == 0

    assert register_failed_login(account, now, policy=policy) == 900
    assert lockout_seconds_remaining(account, now + timedelta(minutes=14)) == 60


def test_login_lockout_policy_resolves_valid_numeric_settings() -> None:
    policy = resolve_login_lockout_policy(
        {
            "security.loginAttemptLimit": 10,
            "security.loginLockMinutes": 30,
        }
    )

    assert policy == LoginLockoutPolicy(attempt_limit=10, lock_minutes=30)


def test_login_lockout_policy_ignores_invalid_and_legacy_settings() -> None:
    policy = resolve_login_lockout_policy(
        {
            "security.Failed Login Threshold": "10 attempts",
            "security.loginAttemptLimit": "10",
            "security.loginLockMinutes": True,
        }
    )

    assert policy == LoginLockoutPolicy(
        attempt_limit=LOGIN_ATTEMPT_LIMIT, lock_minutes=LOGIN_LOCK_MINUTES
    )


def test_login_lockout_message_uses_configured_threshold() -> None:
    assert (
        login_lockout_message(LoginLockoutPolicy(attempt_limit=10, lock_minutes=30))
        == "Account temporarily locked after 10 failed attempts."
    )


def _account() -> Account:
    return Account(
        email="user@example.com",
        password_hash="unused",
        role=AccountRole.IT,
        display_name="Test User",
        title="IT Personnel",
        status=AccountStatus.ACTIVE,
    )
