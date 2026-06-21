from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_password
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.accounts.service import get_account_by_email


async def seed_default_it_account(db: AsyncSession) -> None:
    settings = get_settings()
    existing_account = await get_account_by_email(db, settings.default_it_username)
    if existing_account is not None:
        return

    db.add(
        Account(
            email=settings.default_it_username,
            password_hash=hash_password(settings.default_it_password),
            role=AccountRole.IT,
            display_name="Default IT Personnel",
            title="IT Personnel",
            status=AccountStatus.ACTIVE,
        ),
    )
    await db.commit()
