import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from math import ceil

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.password_policy import validate_password_policy
from app.core.security import hash_password
from app.features.accounts.models import Account, AccountStatus
from app.features.accounts.service import get_account_by_email
from app.features.activity_logs.models import ActivityLog
from app.features.auth.account_activation import invalidate_account_activation_tokens
from app.features.auth.challenge_service import (
    invalidate_password_reset_challenges,
    invalidate_password_reset_challenges_for_email,
)
from app.features.auth.models import PasswordResetChallenge
from app.features.auth.recovery_rate_limit import (
    PasswordResetRateContext,
    PasswordResetRateLimitExceeded,
    consume_password_reset_rate_limits,
    password_reset_rate_context,
)
from app.features.auth.secret_values import derive_password_reset_code
from app.features.mail.models import EmailTemplateName
from app.features.mail.service import (
    cancel_pending_source_emails,
    email_idempotency_key,
    enqueue_email,
)

OTP_TTL_MINUTES = 10
MAX_OTP_ATTEMPTS = 5
MAX_RESET_TOKEN_ATTEMPTS = 5


class PasswordRecoveryError(Exception):
    pass


@dataclass(frozen=True)
class PasswordResetRequestResult:
    challenge_id: str
    expires_in_minutes: int
    resend_available_in_seconds: int
    reused_challenge: bool


def _now() -> datetime:
    return datetime.now(UTC)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _hash_secret(challenge_id: str, value: str, purpose: str) -> str:
    settings = get_settings()
    message = f"{purpose}:{challenge_id}:{value}".encode()
    return hmac.new(settings.email_secret_key_value.encode(), message, hashlib.sha256).hexdigest()


async def request_password_reset(
    db: AsyncSession,
    email: str,
    *,
    client_ip: str = "unavailable",
) -> PasswordResetRequestResult:
    settings = get_settings()
    normalized_email = email.strip().lower()
    now = _now()
    rate_context = password_reset_rate_context(
        settings,
        normalized_email=normalized_email,
        client_ip=client_ip,
    )
    try:
        await consume_password_reset_rate_limits(
            db,
            settings,
            rate_context,
            now=now,
        )
    except PasswordResetRateLimitExceeded as exc:
        if exc.should_record_event:
            _add_request_security_log(
                db,
                exc.context,
                outcome="rate_limited",
                metadata={
                    "retryAfterSeconds": exc.retry_after_seconds,
                    "scopes": ",".join(exc.exceeded_scopes),
                },
            )
        await db.commit()
        raise

    recent_challenge = await db.scalar(
        select(PasswordResetChallenge)
        .where(
            PasswordResetChallenge.email == normalized_email,
            PasswordResetChallenge.expires_at > now,
            PasswordResetChallenge.used.is_(False),
            PasswordResetChallenge.code_consumed.is_(False),
            PasswordResetChallenge.invalidated_at.is_(None),
        )
        .order_by(PasswordResetChallenge.created_at.desc())
        .with_for_update()
        .limit(1)
    )
    cooldown_seconds = settings.password_reset_resend_cooldown_seconds
    if recent_challenge is not None and recent_challenge.created_at is not None:
        cooldown_ends_at = _as_utc(recent_challenge.created_at) + timedelta(
            seconds=cooldown_seconds
        )
        if cooldown_ends_at > now:
            resend_available_in = max(1, ceil((cooldown_ends_at - now).total_seconds()))
            _add_request_security_log(
                db,
                rate_context,
                outcome="cooldown_reused",
                metadata={"resendAvailableInSeconds": resend_available_in},
            )
            await db.commit()
            return _request_result(
                recent_challenge,
                now=now,
                resend_available_in_seconds=resend_available_in,
                reused_challenge=True,
            )

    await invalidate_password_reset_challenges_for_email(
        db,
        normalized_email,
        invalidated_at=now,
    )

    challenge_id = secrets.token_urlsafe(32)
    code = derive_password_reset_code(challenge_id)
    expires_at = now + timedelta(minutes=OTP_TTL_MINUTES)
    account = await get_account_by_email(db, normalized_email)
    eligible_account = (
        account
        if account is not None
        and account.status == AccountStatus.ACTIVE
        and account.activated_at is not None
        else None
    )
    challenge = PasswordResetChallenge(
        id=challenge_id,
        email=normalized_email,
        account_id=eligible_account.id if eligible_account is not None else None,
        code_hash=_hash_secret(challenge_id, code, "password-reset-code"),
        expires_at=expires_at,
        attempts=0,
        reset_attempts=0,
        verified=False,
        code_consumed=False,
        used=False,
    )
    db.add(challenge)

    if eligible_account is not None:
        expires_label = expires_at.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")
        await enqueue_email(
            db,
            account_id=eligible_account.id,
            source_id=challenge.id,
            recipient=eligible_account.email,
            template_name=EmailTemplateName.PASSWORD_RESET,
            template_payload={
                "challengeId": challenge.id,
                "displayName": eligible_account.display_name,
                "email": eligible_account.email,
                "role": eligible_account.role.value,
                "enterpriseId": (
                    eligible_account.enterprise_profile.enterprise_id
                    if eligible_account.enterprise_profile is not None
                    else ""
                ),
                "expiresLabel": expires_label,
            },
            idempotency_key=email_idempotency_key("password-reset", challenge.id),
            tags={"category": "password_reset"},
            valid_until=challenge.expires_at,
        )
    _add_request_security_log(
        db,
        rate_context,
        outcome="challenge_created",
        metadata={"resendAvailableInSeconds": cooldown_seconds},
    )
    await db.commit()

    return _request_result(
        challenge,
        now=now,
        resend_available_in_seconds=cooldown_seconds,
        reused_challenge=False,
    )


async def verify_password_reset_code(db: AsyncSession, challenge_id: str, code: str) -> str:
    challenge = await db.scalar(
        select(PasswordResetChallenge)
        .where(PasswordResetChallenge.id == challenge_id)
        .with_for_update()
    )
    fingerprint = _audit_fingerprint("challenge", challenge_id)
    if (
        challenge is None
        or challenge.used
        or challenge.code_consumed
        or challenge.invalidated_at is not None
        or challenge.account_id is None
    ):
        raise PasswordRecoveryError("Invalid or expired verification code.")

    now = _now()
    if _as_utc(challenge.expires_at) <= now or challenge.attempts >= MAX_OTP_ATTEMPTS:
        await _invalidate_challenge(db, challenge, invalidated_at=now)
        _add_challenge_security_log(
            db,
            fingerprint,
            action="Password Recovery Verification Rejected",
            outcome="expired_or_exhausted",
            severity="Warning",
        )
        await db.commit()
        raise PasswordRecoveryError("Invalid or expired verification code.")

    challenge.attempts += 1
    expected_hash = _hash_secret(challenge.id, code.strip(), "password-reset-code")
    if not hmac.compare_digest(challenge.code_hash, expected_hash):
        if challenge.attempts >= MAX_OTP_ATTEMPTS:
            await _invalidate_challenge(db, challenge, invalidated_at=now)
        _add_challenge_security_log(
            db,
            fingerprint,
            action="Password Recovery Verification Rejected",
            outcome="invalid_code",
            severity="Warning",
            metadata={"attemptCount": challenge.attempts},
        )
        await db.commit()
        raise PasswordRecoveryError("Invalid or expired verification code.")

    reset_token = secrets.token_urlsafe(32)
    challenge.verified = True
    challenge.verified_at = now
    challenge.code_consumed = True
    challenge.code_hash = ""
    challenge.reset_token_hash = _hash_secret(challenge.id, reset_token, "password-reset-token")
    await cancel_pending_source_emails(
        db,
        template_name=EmailTemplateName.PASSWORD_RESET,
        source_ids=[challenge.id],
        reason="The password recovery code was already verified.",
    )
    _add_challenge_security_log(
        db,
        fingerprint,
        action="Password Recovery Code Verified",
        outcome="verified",
        severity="Success",
    )
    await db.commit()
    return reset_token


async def reset_password_with_token(
    db: AsyncSession,
    *,
    challenge_id: str,
    reset_token: str,
    new_password: str,
) -> Account:
    validate_password_policy(new_password)
    challenge = await db.scalar(
        select(PasswordResetChallenge)
        .where(PasswordResetChallenge.id == challenge_id)
        .with_for_update()
    )
    fingerprint = _audit_fingerprint("challenge", challenge_id)
    if (
        challenge is None
        or challenge.used
        or challenge.invalidated_at is not None
        or not challenge.verified
        or challenge.account_id is None
    ):
        raise PasswordRecoveryError("Password reset session is invalid or expired.")

    now = _now()
    if (
        _as_utc(challenge.expires_at) <= now
        or challenge.reset_token_hash is None
        or challenge.reset_attempts >= MAX_RESET_TOKEN_ATTEMPTS
    ):
        await _invalidate_challenge(db, challenge, invalidated_at=now)
        _add_challenge_security_log(
            db,
            fingerprint,
            action="Password Recovery Reset Rejected",
            outcome="expired",
            severity="Warning",
        )
        await db.commit()
        raise PasswordRecoveryError("Password reset session is invalid or expired.")

    token_hash = _hash_secret(challenge.id, reset_token, "password-reset-token")
    if not hmac.compare_digest(challenge.reset_token_hash, token_hash):
        challenge.reset_attempts += 1
        if challenge.reset_attempts >= MAX_RESET_TOKEN_ATTEMPTS:
            await _invalidate_challenge(db, challenge, invalidated_at=now)
        _add_challenge_security_log(
            db,
            fingerprint,
            action="Password Recovery Reset Rejected",
            outcome="invalid_token",
            severity="Warning",
            metadata={"attemptCount": challenge.reset_attempts},
        )
        await db.commit()
        raise PasswordRecoveryError("Password reset session is invalid or expired.")

    account = await db.scalar(
        select(Account).where(Account.id == challenge.account_id).with_for_update()
    )
    if account is None or account.status != AccountStatus.ACTIVE or account.activated_at is None:
        await _invalidate_challenge(db, challenge, invalidated_at=now)
        _add_challenge_security_log(
            db,
            fingerprint,
            action="Password Recovery Reset Rejected",
            outcome="account_unavailable",
            severity="Warning",
        )
        await db.commit()
        raise PasswordRecoveryError("Password reset session is invalid or expired.")

    account.password_hash = hash_password(new_password)
    account.password_changed_at = now
    account.failed_login_attempts = 0
    account.locked_until = None
    account.token_invalid_before = now
    challenge.used = True
    challenge.used_at = now
    challenge.reset_token_hash = None
    await invalidate_account_activation_tokens(db, account.id, invalidated_at=now)
    await invalidate_password_reset_challenges(
        db,
        account.id,
        invalidated_at=now,
        except_challenge_id=challenge.id,
    )
    _add_challenge_security_log(
        db,
        fingerprint,
        action="Password Recovery Reset Completed",
        outcome="password_changed",
        severity="Success",
    )
    await db.commit()
    await db.refresh(account)
    return account


def _request_result(
    challenge: PasswordResetChallenge,
    *,
    now: datetime,
    resend_available_in_seconds: int,
    reused_challenge: bool,
) -> PasswordResetRequestResult:
    expires_in_seconds = max(1, ceil((_as_utc(challenge.expires_at) - now).total_seconds()))
    return PasswordResetRequestResult(
        challenge_id=challenge.id,
        expires_in_minutes=max(1, ceil(expires_in_seconds / 60)),
        resend_available_in_seconds=resend_available_in_seconds,
        reused_challenge=reused_challenge,
    )


async def _invalidate_challenge(
    db: AsyncSession,
    challenge: PasswordResetChallenge,
    *,
    invalidated_at: datetime,
) -> None:
    challenge.used = True
    challenge.code_consumed = True
    challenge.code_hash = ""
    challenge.reset_token_hash = None
    challenge.invalidated_at = invalidated_at
    await cancel_pending_source_emails(
        db,
        template_name=EmailTemplateName.PASSWORD_RESET,
        source_ids=[challenge.id],
        reason="The password recovery request expired or became invalid.",
    )


def _add_request_security_log(
    db: AsyncSession,
    context: PasswordResetRateContext,
    *,
    outcome: str,
    metadata: dict[str, str | int] | None = None,
) -> None:
    event_metadata: dict[str, str | int] = {
        "outcome": outcome,
        "identifierFingerprint": context.identifier_hash[:16],
        "ipFingerprint": context.ip_hash[:16],
    }
    if metadata:
        event_metadata.update(metadata)
    db.add(
        ActivityLog(
            category="System",
            severity="Warning" if outcome == "rate_limited" else "Info",
            actor="TANAW Security",
            actor_role="System",
            action="Password Recovery Request",
            target=f"Identifier {context.identifier_hash[:12]}",
            summary="A generic password recovery request was processed.",
            source_id=f"password-recovery:{context.identifier_hash[:32]}",
            metadata_json=json.dumps(event_metadata, sort_keys=True),
        )
    )


def _add_challenge_security_log(
    db: AsyncSession,
    fingerprint: str,
    *,
    action: str,
    outcome: str,
    severity: str,
    metadata: dict[str, str | int] | None = None,
) -> None:
    event_metadata: dict[str, str | int] = {"outcome": outcome}
    if metadata:
        event_metadata.update(metadata)
    db.add(
        ActivityLog(
            category="System",
            severity=severity,
            actor="TANAW Security",
            actor_role="System",
            action=action,
            target=f"Challenge {fingerprint[:12]}",
            summary="A password recovery security event was recorded.",
            source_id=f"password-recovery-challenge:{fingerprint[:32]}",
            metadata_json=json.dumps(event_metadata, sort_keys=True),
        )
    )


def _audit_fingerprint(purpose: str, value: str) -> str:
    settings = get_settings()
    return hmac.new(
        settings.email_secret_key_value.encode(),
        f"password-recovery-audit:{purpose}:{value}".encode(),
        hashlib.sha256,
    ).hexdigest()
