from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_password, verify_password
from app.features.accounts.defaults import (
    StartupAccountSpec,
    get_startup_account_specs,
)
from app.features.accounts.models import Account, AccountStatus
from app.features.accounts.service import get_account_by_email


async def get_seeded_account(db: AsyncSession, spec: StartupAccountSpec) -> Account | None:
    result = await db.scalars(
        select(Account).where(
            Account.role == spec.role,
            Account.display_name == spec.display_name,
        )
    )
    return result.first()


async def seed_default_accounts(db: AsyncSession) -> None:
    specs = get_startup_account_specs(get_settings())
    configured_emails = {spec.email for spec in specs}
    if len(configured_emails) != len(specs):
        raise RuntimeError("Startup-seeded account usernames must be unique.")

    for spec in specs:
        await seed_startup_account(db, spec)

    await db.commit()


async def seed_startup_account(db: AsyncSession, spec: StartupAccountSpec) -> None:
    account = await get_seeded_account(db, spec)
    configured_account = await get_account_by_email(db, spec.email)

    if (
        account is not None
        and configured_account is not None
        and account.id != configured_account.id
    ):
        raise RuntimeError(f"{spec.username_setting} is already assigned to a different account.")

    if account is None:
        account = configured_account

    if account is None:
        account = Account(
            email=spec.email,
            password_hash=hash_password(spec.password),
            role=spec.role,
            display_name=spec.display_name,
            title=spec.title,
            first_name=spec.first_name,
            last_name=spec.last_name,
            status=AccountStatus.ACTIVE,
        )
        db.add(account)
    else:
        if not verify_password(spec.password, account.password_hash):
            account.password_hash = hash_password(spec.password)
            account.token_invalid_before = datetime.now(UTC)

        account.email = spec.email
        account.role = spec.role
        account.display_name = spec.display_name
        account.title = spec.title
        account.first_name = spec.first_name
        account.last_name = spec.last_name
        account.status = AccountStatus.ACTIVE

    account.must_change_password = False
    account.temporary_password_created_at = None
    account.temporary_password_expires_at = None
    account.failed_login_attempts = 0
    account.locked_until = None
