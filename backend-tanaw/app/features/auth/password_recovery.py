import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import hash_password
from app.features.accounts.models import (
    Account,
    AccountStatus,
    DeliveryChannel,
    DeliveryStatus,
    DevDelivery,
)
from app.features.accounts.service import get_account_by_email, get_account_by_id

OTP_TTL_MINUTES = 10
MAX_OTP_ATTEMPTS = 5


class PasswordRecoveryError(Exception):
    pass


@dataclass
class PasswordResetChallenge:
    id: str
    email: str
    account_id: str | None
    code_hash: str
    expires_at: datetime
    attempts: int = 0
    verified: bool = False
    code_consumed: bool = False
    used: bool = False
    reset_token_hash: str | None = None


_password_reset_challenges: dict[str, PasswordResetChallenge] = {}


def _now() -> datetime:
    return datetime.now(UTC)


def _hash_secret(challenge_id: str, value: str, purpose: str) -> str:
    settings = get_settings()
    message = f"{purpose}:{challenge_id}:{value}".encode()
    return hmac.new(settings.jwt_secret_key.encode(), message, hashlib.sha256).hexdigest()


def _generate_code() -> str:
    return "".join(secrets.choice("0123456789") for _ in range(6))


def _cleanup_challenges() -> None:
    now = _now()
    expired_ids = [
        challenge_id
        for challenge_id, challenge in _password_reset_challenges.items()
        if challenge.used or challenge.expires_at <= now
    ]
    for challenge_id in expired_ids:
        _password_reset_challenges.pop(challenge_id, None)


def _create_recovery_delivery(account: Account, code: str, expires_at: datetime) -> DevDelivery:
    expires_label = expires_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")
    return DevDelivery(
        account_id=account.id,
        channel=DeliveryChannel.EMAIL,
        recipient=account.email,
        subject="TANAW password reset verification code",
        body=(
            f"Hello {account.display_name},\n\n"
            "A TANAW password reset was requested for your account.\n"
            f"Verification code: {code}\n"
            f"This code expires at {expires_label} and can be used once.\n\n"
            "If you did not request this reset, please contact the TANAW system administrator."
        ),
        status=DeliveryStatus.RECORDED,
    )


async def request_password_reset(db: AsyncSession, email: str) -> PasswordResetChallenge:
    _cleanup_challenges()
    normalized_email = email.strip().lower()
    challenge_id = str(uuid4())
    code = _generate_code()
    expires_at = _now() + timedelta(minutes=OTP_TTL_MINUTES)
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
    )
    _password_reset_challenges[challenge.id] = challenge

    if eligible_account is not None:
        db.add(_create_recovery_delivery(eligible_account, code, expires_at))
        await db.commit()

    return challenge


def verify_password_reset_code(challenge_id: str, code: str) -> str:
    _cleanup_challenges()
    challenge = _password_reset_challenges.get(challenge_id)
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
        raise PasswordRecoveryError("Invalid or expired verification code.")

    reset_token = secrets.token_urlsafe(32)
    challenge.verified = True
    challenge.code_consumed = True
    challenge.code_hash = ""
    challenge.reset_token_hash = _hash_secret(challenge.id, reset_token, "password-reset-token")
    return reset_token


async def reset_password_with_token(
    db: AsyncSession,
    *,
    challenge_id: str,
    reset_token: str,
    new_password: str,
) -> Account:
    _cleanup_challenges()
    challenge = _password_reset_challenges.get(challenge_id)
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

    now = _now()
    account.password_hash = hash_password(new_password)
    account.must_change_password = False
    account.temporary_password_created_at = None
    account.temporary_password_expires_at = None
    account.password_changed_at = now
    account.failed_login_attempts = 0
    account.locked_until = None
    account.token_invalid_before = now
    await db.commit()
    await db.refresh(account)

    challenge.used = True
    _password_reset_challenges.pop(challenge.id, None)
    return account
