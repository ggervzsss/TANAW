from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.features.auth.models import PasswordResetChallenge
from app.features.mail.models import EmailTemplateName
from app.features.mail.service import cancel_pending_source_emails


async def invalidate_password_reset_challenges(
    db: AsyncSession,
    account_id: str,
    *,
    invalidated_at: datetime,
    except_challenge_id: str | None = None,
) -> None:
    conditions = [
        PasswordResetChallenge.account_id == account_id,
        PasswordResetChallenge.used.is_(False),
        PasswordResetChallenge.invalidated_at.is_(None),
    ]
    if except_challenge_id is not None:
        conditions.append(PasswordResetChallenge.id != except_challenge_id)
    await _invalidate_matching_password_reset_challenges(
        db,
        conditions=conditions,
        invalidated_at=invalidated_at,
    )


async def invalidate_password_reset_challenges_for_email(
    db: AsyncSession,
    email: str,
    *,
    invalidated_at: datetime,
) -> None:
    await _invalidate_matching_password_reset_challenges(
        db,
        conditions=[
            PasswordResetChallenge.email == email.strip().lower(),
            PasswordResetChallenge.used.is_(False),
            PasswordResetChallenge.invalidated_at.is_(None),
        ],
        invalidated_at=invalidated_at,
    )


async def _invalidate_matching_password_reset_challenges(
    db: AsyncSession,
    *,
    conditions: list[ColumnElement[bool]],
    invalidated_at: datetime,
) -> None:
    source_ids = list(await db.scalars(select(PasswordResetChallenge.id).where(*conditions)))
    await db.execute(
        update(PasswordResetChallenge)
        .where(*conditions)
        .values(
            used=True,
            code_consumed=True,
            code_hash="",
            reset_token_hash=None,
            invalidated_at=invalidated_at,
        )
    )
    await cancel_pending_source_emails(
        db,
        template_name=EmailTemplateName.PASSWORD_RESET,
        source_ids=source_ids,
        reason="This password recovery request is no longer valid.",
    )
