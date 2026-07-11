import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import quote
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.password_policy import validate_password_policy
from app.core.security import hash_password
from app.features.accounts.models import Account, AccountStatus
from app.features.auth.challenge_service import invalidate_password_reset_challenges
from app.features.auth.models import AccountActivationToken
from app.features.mail.service import deliver_email, email_idempotency_key
from app.features.mail.templates import account_activation_email


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
        settings.jwt_secret_key.encode(),
        f"account-activation:{raw_token}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _activation_url(raw_token: str) -> str:
    settings = get_settings()
    return f"{settings.frontend_public_url}/activate-account#token={quote(raw_token)}"


async def invalidate_account_activation_tokens(
    db: AsyncSession,
    account_id: str,
    *,
    except_token_id: str | None = None,
    invalidated_at: datetime | None = None,
) -> None:
    statement = update(AccountActivationToken).where(
        AccountActivationToken.account_id == account_id,
        AccountActivationToken.consumed_at.is_(None),
        AccountActivationToken.invalidated_at.is_(None),
    )
    if except_token_id is not None:
        statement = statement.where(AccountActivationToken.id != except_token_id)
    await db.execute(statement.values(invalidated_at=invalidated_at or _now()))


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
    raw_token = secrets.token_urlsafe(32)
    token = AccountActivationToken(
        id=str(uuid4()),
        account_id=account.id,
        token_hash=_hash_token(raw_token),
        expires_at=now + timedelta(hours=settings.account_activation_ttl_hours),
    )
    await invalidate_account_activation_tokens(db, account.id, invalidated_at=now)
    db.add(token)
    await db.flush()

    expires_label = token.expires_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")
    await deliver_email(
        db,
        account_id=account.id,
        recipient=account.email,
        content=account_activation_email(
            account,
            _activation_url(raw_token),
            expires_label,
        ),
        idempotency_key=email_idempotency_key("account-activation", token.id),
        tags={"category": "account_activation"},
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
