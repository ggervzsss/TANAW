import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.password_policy import validate_password_policy
from app.core.security import hash_password
from app.features.accounts.models import Account, AccountStatus
from app.features.accounts.service import get_account_by_email, get_account_by_id
from app.features.auth.models import PasswordResetChallenge
from app.features.mail.service import deliver_email, email_idempotency_key
from app.features.mail.templates import password_reset_code_email

OTP_TTL_MINUTES = 10
MAX_OTP_ATTEMPTS = 5
OTP_RESEND_COOLDOWN_SECONDS = 60


class PasswordRecoveryError(Exception):
    pass


def _now() -> datetime:
    return datetime.now(UTC)


def _hash_secret(challenge_id: str, value: str, purpose: str) -> str:
    settings = get_settings()
    message = f"{purpose}:{challenge_id}:{value}".encode()
    return hmac.new(settings.jwt_secret_key.encode(), message, hashlib.sha256).hexdigest()


def _generate_code() -> str:
    return "".join(secrets.choice("0123456789") for _ in range(6))


async def request_password_reset(db: AsyncSession, email: str) -> PasswordResetChallenge:
    normalized_email = email.strip().lower()
    now = _now()
    recent_challenge = await db.scalar(
        select(PasswordResetChallenge)
        .where(
            PasswordResetChallenge.email == normalized_email,
            PasswordResetChallenge.expires_at > now,
            PasswordResetChallenge.used.is_(False),
        )
        .order_by(PasswordResetChallenge.created_at.desc())
        .limit(1)
    )
    if (
        recent_challenge is not None
        and recent_challenge.created_at is not None
        and recent_challenge.created_at > now - timedelta(seconds=OTP_RESEND_COOLDOWN_SECONDS)
    ):
        return recent_challenge

    challenge_id = str(uuid4())
    code = _generate_code()
    expires_at = now + timedelta(minutes=OTP_TTL_MINUTES)
    account = await get_account_by_email(db, normalized_email)
    eligible_account = (
        account if account is not None and account.status == AccountStatus.ACTIVE else None
    )
    challenge = PasswordResetChallenge(
        id=challenge_id,
        email=normalized_email,
        account_id=eligible_account.id if eligible_account is not None else None,
        code_hash=_hash_secret(challenge_id, code, "password-reset-code"),
        expires_at=expires_at,
        attempts=0,
        verified=False,
        code_consumed=False,
        used=False,
    )
    db.add(challenge)

    if eligible_account is not None:
        expires_label = expires_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")
        await deliver_email(
            db,
            account_id=eligible_account.id,
            recipient=eligible_account.email,
            content=password_reset_code_email(eligible_account, code, expires_label),
            idempotency_key=email_idempotency_key("password-reset", challenge.id),
            tags={"category": "password_reset"},
        )
    await db.commit()

    return challenge


async def verify_password_reset_code(db: AsyncSession, challenge_id: str, code: str) -> str:
    challenge = await db.scalar(
        select(PasswordResetChallenge).where(PasswordResetChallenge.id == challenge_id)
    )
    if (
        challenge is None
        or challenge.used
        or challenge.code_consumed
        or challenge.account_id is None
    ):
        raise PasswordRecoveryError("Invalid or expired verification code.")
    if challenge.expires_at <= _now() or challenge.attempts >= MAX_OTP_ATTEMPTS:
        raise PasswordRecoveryError("Invalid or expired verification code.")

    challenge.attempts += 1
    expected_hash = _hash_secret(challenge.id, code.strip(), "password-reset-code")
    if not hmac.compare_digest(challenge.code_hash, expected_hash):
        await db.commit()
        raise PasswordRecoveryError("Invalid or expired verification code.")

    reset_token = secrets.token_urlsafe(32)
    challenge.verified = True
    challenge.code_consumed = True
    challenge.code_hash = ""
    challenge.reset_token_hash = _hash_secret(challenge.id, reset_token, "password-reset-token")
    await db.commit()
    return reset_token


async def reset_password_with_token(
    db: AsyncSession,
    *,
    challenge_id: str,
    reset_token: str,
    new_password: str,
) -> Account:
    challenge = await db.scalar(
        select(PasswordResetChallenge).where(PasswordResetChallenge.id == challenge_id)
    )
    if (
        challenge is None
        or challenge.used
        or not challenge.verified
        or challenge.account_id is None
    ):
        raise PasswordRecoveryError("Password reset session is invalid or expired.")
    if challenge.expires_at <= _now() or challenge.reset_token_hash is None:
        raise PasswordRecoveryError("Password reset session is invalid or expired.")

    token_hash = _hash_secret(challenge.id, reset_token, "password-reset-token")
    if not hmac.compare_digest(challenge.reset_token_hash, token_hash):
        raise PasswordRecoveryError("Password reset session is invalid or expired.")

    account = await get_account_by_id(db, challenge.account_id)
    if account is None or account.status != AccountStatus.ACTIVE:
        raise PasswordRecoveryError("Password reset session is invalid or expired.")

    validate_password_policy(new_password)
    now = _now()
    account.password_hash = hash_password(new_password)
    account.must_change_password = False
    account.temporary_password_created_at = None
    account.temporary_password_expires_at = None
    account.password_changed_at = now
    account.failed_login_attempts = 0
    account.locked_until = None
    account.token_invalid_before = now
    challenge.used = True
    challenge.reset_token_hash = None
    await db.commit()
    await db.refresh(account)
    return account
