import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.password_policy import validate_password_policy
from app.core.security import hash_password
from app.features.accounts.models import Account, AccountStatus
from app.features.auth.challenge_service import invalidate_password_reset_challenges
from app.features.auth.models import AccountActivationToken
from app.features.auth.secret_values import derive_account_activation_token
from app.features.mail.models import EmailTemplateName
from app.features.mail.service import (
    cancel_pending_source_emails,
    email_idempotency_key,
    enqueue_email,
)


class AccountActivationError(ValueError):
    pass


@dataclass(frozen=True)
class AccountActivationDetails:
    display_name: str
    role: str
    expires_at: datetime


def _now() -> datetime:
    return datetime.now(UTC)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _hash_token(raw_token: str) -> str:
    settings = get_settings()
    return hmac.new(
        settings.email_secret_key_value.encode(),
        f"account-activation:{raw_token}".encode(),
        hashlib.sha256,
    ).hexdigest()


async def invalidate_account_activation_tokens(
    db: AsyncSession,
    account_id: str,
    *,
    except_token_id: str | None = None,
    invalidated_at: datetime | None = None,
) -> None:
    conditions = (
        AccountActivationToken.account_id == account_id,
        AccountActivationToken.consumed_at.is_(None),
        AccountActivationToken.invalidated_at.is_(None),
    )
    source_statement = select(AccountActivationToken.id).where(*conditions)
    statement = update(AccountActivationToken).where(*conditions)
    if except_token_id is not None:
        source_statement = source_statement.where(AccountActivationToken.id != except_token_id)
        statement = statement.where(AccountActivationToken.id != except_token_id)
    source_ids = list(await db.scalars(source_statement))
    await db.execute(statement.values(invalidated_at=invalidated_at or _now()))
    await cancel_pending_source_emails(
        db,
        template_name=EmailTemplateName.ACCOUNT_ACTIVATION,
        source_ids=source_ids,
        reason="A newer activation request replaced this email.",
    )


async def issue_account_activation(
    db: AsyncSession,
    account: Account,
    *,
    lock_account: bool = True,
) -> AccountActivationToken:
    if lock_account:
        locked_account = await db.scalar(
            select(Account).where(Account.id == account.id).with_for_update()
        )
        if locked_account is None:
            raise AccountActivationError("Account not found.")
        account = locked_account
    if account.status != AccountStatus.ACTIVE:
        raise AccountActivationError("Only active accounts can receive an activation link.")
    if account.activated_at is not None:
        raise AccountActivationError("This account is already activated.")

    settings = get_settings()
    now = _now()
    token_id = secrets.token_urlsafe(32)
    raw_token = derive_account_activation_token(token_id)
    token = AccountActivationToken(
        id=token_id,
        account_id=account.id,
        token_hash=_hash_token(raw_token),
        expires_at=now + timedelta(hours=settings.account_activation_ttl_hours),
    )
    await invalidate_account_activation_tokens(db, account.id, invalidated_at=now)
    db.add(token)
    await db.flush()

    expires_label = token.expires_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")
    await enqueue_email(
        db,
        account_id=account.id,
        source_id=token.id,
        recipient=account.email,
        template_name=EmailTemplateName.ACCOUNT_ACTIVATION,
        template_payload={
            "tokenId": token.id,
            "displayName": account.display_name,
            "email": account.email,
            "role": account.role.value,
            "enterpriseId": account.enterprise_id or "",
            "frontendPublicUrl": settings.frontend_public_url,
            "expiresLabel": expires_label,
        },
        idempotency_key=email_idempotency_key("account-activation", token.id),
        tags={"category": "account_activation"},
        valid_until=token.expires_at,
    )
    return token


async def validate_account_activation(db: AsyncSession, raw_token: str) -> AccountActivationDetails:
    token, account = await _resolve_activation(db, raw_token, lock=False)
    return AccountActivationDetails(
        display_name=account.display_name,
        role=account.role.value,
        expires_at=_as_utc(token.expires_at),
    )


async def complete_account_activation(
    db: AsyncSession, raw_token: str, new_password: str
) -> Account:
    validate_password_policy(new_password)
    token, account = await _resolve_activation(db, raw_token, lock=True)
    now = _now()

    account.password_hash = hash_password(new_password)
    account.activated_at = now
    account.password_changed_at = now
    account.token_invalid_before = now
    account.failed_login_attempts = 0
    account.locked_until = None
    token.consumed_at = now
    await invalidate_account_activation_tokens(
        db,
        account.id,
        except_token_id=token.id,
        invalidated_at=now,
    )
    await invalidate_password_reset_challenges(db, account.id, invalidated_at=now)
    await db.commit()
    await db.refresh(account)
    return account


async def _resolve_activation(
    db: AsyncSession, raw_token: str, *, lock: bool
) -> tuple[AccountActivationToken, Account]:
    normalized_token = raw_token.strip()
    if not normalized_token:
        raise AccountActivationError("Activation link is invalid or expired.")

    statement = select(AccountActivationToken).where(
        AccountActivationToken.token_hash == _hash_token(normalized_token)
    )
    token = _require_available_token(await db.scalar(statement))

    if lock:
        account = await db.scalar(
            select(Account).where(Account.id == token.account_id).with_for_update()
        )
        token = _require_available_token(await db.scalar(statement.with_for_update()))
    else:
        account = await db.scalar(select(Account).where(Account.id == token.account_id))
    if (
        account is None
        or account.status != AccountStatus.ACTIVE
        or account.activated_at is not None
    ):
        raise AccountActivationError("Activation link is invalid or expired.")
    return token, account


def _require_available_token(
    token: AccountActivationToken | None,
) -> AccountActivationToken:
    if (
        token is None
        or token.consumed_at is not None
        or token.invalidated_at is not None
        or _as_utc(token.expires_at) <= _now()
    ):
        raise AccountActivationError("Activation link is invalid or expired.")
    return token
