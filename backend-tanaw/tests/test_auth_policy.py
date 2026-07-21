from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.config import Settings
from app.core.password_policy import (
    PASSWORD_COMMON_MESSAGE,
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    PASSWORD_TOO_LONG_MESSAGE,
    PASSWORD_TOO_SHORT_MESSAGE,
    normalize_password,
    validate_password_policy,
)
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.features.accounts.dependencies import is_token_invalidated
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.schemas import PasswordChangeRequest
from app.features.accounts.service import change_account_password
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


def test_password_policy_uses_length_without_composition_rules() -> None:
    with pytest.raises(ValueError, match=PASSWORD_TOO_SHORT_MESSAGE):
        validate_password_policy("thirteen char!")

    passphrases = (
        "lowercase words are accepted",
        "UPPERCASE WORDS ARE ACCEPTED",
        "数字だけではなく日本語の長い合言葉です",
        "😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀",
        "  leading and trailing spaces stay  ",
    )
    for passphrase in passphrases:
        assert validate_password_policy(passphrase) == normalize_password(passphrase)


def test_password_policy_enforces_bounded_unicode_code_point_length() -> None:
    minimum = "界" * PASSWORD_MIN_LENGTH
    maximum = "😀" * PASSWORD_MAX_LENGTH
    assert validate_password_policy(minimum) == minimum
    assert validate_password_policy(maximum) == maximum

    with pytest.raises(ValueError, match=PASSWORD_TOO_LONG_MESSAGE):
        validate_password_policy("😀" * (PASSWORD_MAX_LENGTH + 1))

    assert (
        PasswordChangeRequest(
            currentPassword="temporary",
            newPassword=maximum,
        ).newPassword
        == maximum
    )
    assert (
        ForgotPasswordResetRequest(
            challengeId="challenge",
            resetToken="token",
            newPassword=maximum,
        ).newPassword
        == maximum
    )


@pytest.mark.parametrize(
    "password",
    (
        "passwordpassword",
        "Password Password Password",
        "correct horse battery staple",
        "123456789012345",
        "tanaw-sanpedro-2026",
        "               ",
    ),
)
def test_password_policy_rejects_common_compromised_and_context_passwords(
    password: str,
) -> None:
    with pytest.raises(ValueError, match=PASSWORD_COMMON_MESSAGE):
        validate_password_policy(password)


def test_password_policy_normalizes_unicode_before_storage_and_verification() -> None:
    decomposed = "Cafe\u0301 has a secure passphrase"
    composed = "Café has a secure passphrase"
    assert validate_password_policy(decomposed) == composed
    assert normalize_password(decomposed) == composed

    password_digest = hash_password(decomposed)
    assert verify_password(decomposed, password_digest)
    assert verify_password(composed, password_digest)


def test_client_password_blocklist_data_matches_backend() -> None:
    repository_root = Path(__file__).resolve().parents[2]
    backend_data = (repository_root / "backend-tanaw/app/core/common_passwords.json").read_bytes()
    assert (
        repository_root / "frontend-tanaw/src/shared/data/commonPasswords.json"
    ).read_bytes() == backend_data
    assert (
        repository_root / "desktop-tanaw/src/data/commonPasswords.json"
    ).read_bytes() == backend_data


def test_local_startup_credentials_are_not_subject_to_the_user_password_policy() -> None:
    settings = Settings(
        bootstrap_it_username="default@email.com",
        bootstrap_it_password="default",
        seed_development_accounts=True,
        development_admin_username="admin@email.com",
        development_admin_password="admin123",
        development_staff_username="staff@email.com",
        development_staff_password="staffstaff",
        development_it_username="it@email.com",
        development_it_password="it123456",
    )

    assert settings.bootstrap_it_password == "default"
    assert settings.development_admin_password == "admin123"
    assert settings.development_staff_password == "staffstaff"
    assert settings.development_it_password == "it123456"


def test_access_token_issued_after_revocation_in_same_second_stays_valid() -> None:
    account = _account()
    token = decode_access_token(create_access_token("account-1"))
    issued_at = token["iat"]

    assert isinstance(issued_at, float)
    account.token_invalid_before = datetime.fromtimestamp(issued_at - 0.000001, UTC)
    assert is_token_invalidated(token, account) is False

    account.token_invalid_before = datetime.fromtimestamp(issued_at + 0.000001, UTC)
    assert is_token_invalidated(token, account) is True


@pytest.mark.asyncio
async def test_password_change_revokes_sessions_and_recovery_challenges() -> None:
    account = _account()
    account.id = "account-1"
    account.password_hash = hash_password("Existing1!Password")
    db = MagicMock()
    db.execute = AsyncMock()
    db.scalars = AsyncMock(return_value=[])
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    changed = await change_account_password(
        db, account, "Existing1!Password", "Replacement2!Password"
    )

    assert changed is True
    assert verify_password("Replacement2!Password", account.password_hash)
    assert account.password_changed_at is not None
    assert account.token_invalid_before == account.password_changed_at
    db.execute.assert_awaited_once()
    db.commit.assert_awaited_once()
    db.refresh.assert_awaited_once_with(account)


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


def test_login_lockout_policy_ignores_invalid_settings() -> None:
    policy = resolve_login_lockout_policy(
        {
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
