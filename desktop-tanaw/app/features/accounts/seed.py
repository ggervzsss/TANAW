from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_password, verify_password
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.service import get_account_by_email

DEFAULT_IT_DISPLAY_NAME = "Default IT Personnel"


async def get_default_it_account(db: AsyncSession) -> Account | None:
    result = await db.scalars(
        select(Account).where(
            Account.role == AccountRole.IT,
            Account.display_name == DEFAULT_IT_DISPLAY_NAME,
        )
    )
    return result.first()


async def seed_default_it_account(db: AsyncSession) -> None:
    settings = get_settings()
    configured_username = settings.default_it_username.strip().lower()
    account = await get_default_it_account(db)
    configured_account = await get_account_by_email(db, configured_username)

    if (
        account is not None
        and configured_account is not None
        and account.id != configured_account.id
    ):
        raise RuntimeError("DEFAULT_IT_USERNAME is already assigned to a different account.")

    if account is None:
        account = configured_account

    if account is None:
        account = Account(
            email=configured_username,
            password_hash=hash_password(settings.default_it_password),
            role=AccountRole.IT,
            display_name=DEFAULT_IT_DISPLAY_NAME,
            title="IT Personnel",
            status=AccountStatus.ACTIVE,
        )
        db.add(account)
    else:
        if not verify_password(settings.default_it_password, account.password_hash):
            account.password_hash = hash_password(settings.default_it_password)
            account.token_invalid_before = datetime.now(UTC)

        account.email = configured_username
        account.role = AccountRole.IT
        account.display_name = DEFAULT_IT_DISPLAY_NAME
        account.title = "IT Personnel"
        account.status = AccountStatus.ACTIVE

    account.must_change_password = False
    account.temporary_password_created_at = None
    account.temporary_password_expires_at = None
    account.failed_login_attempts = 0
    account.locked_until = None
    await db.commit()
