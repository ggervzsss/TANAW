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


def lockout_seconds_remaining(account: Account, now: datetime | None = None) -> int:
    if account.locked_until is None:
        return 0
    current = now or datetime.now(UTC)
    locked_until = account.locked_until
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=UTC)
    return max(0, int((locked_until - current).total_seconds() + 0.999))


def register_failed_login(account: Account, now: datetime | None = None) -> int:
    current = now or datetime.now(UTC)
    if lockout_seconds_remaining(account, current) > 0:
        return lockout_seconds_remaining(account, current)
    account.failed_login_attempts = (account.failed_login_attempts or 0) + 1
    if account.failed_login_attempts >= LOGIN_ATTEMPT_LIMIT:
        account.failed_login_attempts = 0
        account.locked_until = current + timedelta(minutes=LOGIN_LOCK_MINUTES)
    return lockout_seconds_remaining(account, current)


def clear_login_failures(account: Account) -> None:
    account.failed_login_attempts = 0
    account.locked_until = None
