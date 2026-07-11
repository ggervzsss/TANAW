from datetime import datetime

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.auth.models import PasswordResetChallenge


async def invalidate_password_reset_challenges(
    db: AsyncSession, account_id: str, *, invalidated_at: datetime
) -> None:
    await db.execute(
        update(PasswordResetChallenge)
        .where(
            PasswordResetChallenge.account_id == account_id,
            PasswordResetChallenge.used.is_(False),
        )
        .values(
            used=True,
            code_consumed=True,
            code_hash="",
            reset_token_hash=None,
            expires_at=invalidated_at,
        )
    )
