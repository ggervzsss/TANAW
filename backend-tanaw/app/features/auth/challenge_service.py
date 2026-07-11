from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.auth.models import PasswordResetChallenge
from app.features.mail.models import EmailTemplateName
from app.features.mail.service import cancel_pending_source_emails


async def invalidate_password_reset_challenges(
    db: AsyncSession, account_id: str, *, invalidated_at: datetime
) -> None:
    source_ids = list(
        await db.scalars(
            select(PasswordResetChallenge.id).where(
                PasswordResetChallenge.account_id == account_id,
                PasswordResetChallenge.used.is_(False),
            )
        )
    )
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
    await cancel_pending_source_emails(
        db,
        template_name=EmailTemplateName.PASSWORD_RESET,
        source_ids=source_ids,
        reason="This password recovery request is no longer valid.",
    )
