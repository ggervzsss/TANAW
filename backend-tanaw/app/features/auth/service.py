from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import verify_password
from app.features.accounts.models import Account
from app.features.accounts.service import (
    get_account_by_login_identifier,
    is_temporary_password_expired,
)


async def authenticate_account(db: AsyncSession, username: str, password: str) -> Account | None:
    account = await get_account_by_login_identifier(db, username)
    if account is None or not verify_password(password, account.password_hash):
        return None
    if is_temporary_password_expired(account):
        return None

    return account


LOGIN_ATTEMPT_LIMIT = 3
LOGIN_LOCK_MINUTES = 5
LOGIN_ATTEMPT_LIMIT_SETTING_KEY = "security.loginAttemptLimit"
LOGIN_LOCK_MINUTES_SETTING_KEY = "security.loginLockMinutes"
ALLOWED_LOGIN_ATTEMPT_LIMITS = frozenset({3, 5, 10})
ALLOWED_LOGIN_LOCK_MINUTES = frozenset({5, 15, 30, 60})


@dataclass(frozen=True)
class LoginLockoutPolicy:
    attempt_limit: int = LOGIN_ATTEMPT_LIMIT
    lock_minutes: int = LOGIN_LOCK_MINUTES


def lockout_seconds_remaining(account: Account, now: datetime | None = None) -> int:
    if account.locked_until is None:
        return 0
    current = now or datetime.now(UTC)
    locked_until = account.locked_until
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=UTC)
    return max(0, int((locked_until - current).total_seconds() + 0.999))


def resolve_login_lockout_policy(values: Mapping[str, object] | None) -> LoginLockoutPolicy:
    values = values or {}
    return LoginLockoutPolicy(
        attempt_limit=_resolve_integer_setting(
            values.get(LOGIN_ATTEMPT_LIMIT_SETTING_KEY),
            default=LOGIN_ATTEMPT_LIMIT,
            allowed_values=ALLOWED_LOGIN_ATTEMPT_LIMITS,
        ),
        lock_minutes=_resolve_integer_setting(
            values.get(LOGIN_LOCK_MINUTES_SETTING_KEY),
            default=LOGIN_LOCK_MINUTES,
            allowed_values=ALLOWED_LOGIN_LOCK_MINUTES,
        ),
    )


def login_lockout_message(policy: LoginLockoutPolicy) -> str:
    return f"Account temporarily locked after {policy.attempt_limit} failed attempts."


def register_failed_login(
    account: Account, now: datetime | None = None, policy: LoginLockoutPolicy | None = None
) -> int:
    current = now or datetime.now(UTC)
    lockout_policy = policy or LoginLockoutPolicy()
    if lockout_seconds_remaining(account, current) > 0:
        return lockout_seconds_remaining(account, current)
    account.failed_login_attempts = (account.failed_login_attempts or 0) + 1
    if account.failed_login_attempts >= lockout_policy.attempt_limit:
        account.failed_login_attempts = 0
        account.locked_until = current + timedelta(minutes=lockout_policy.lock_minutes)
    return lockout_seconds_remaining(account, current)


def clear_login_failures(account: Account) -> None:
    account.failed_login_attempts = 0
    account.locked_until = None


def _resolve_integer_setting(value: object, *, default: int, allowed_values: frozenset[int]) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        return default
    return value if value in allowed_values else default
