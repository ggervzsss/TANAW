import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.date_time import format_philippine_datetime
from app.features.accounts.models import (
    Account,
    AccountEmailChangeRequest,
    AccountEmailChangeStatus,
    AccountStatus,
)
from app.features.auth.challenge_service import invalidate_password_reset_challenges
from app.features.auth.secret_values import (
    derive_account_email_change_token,
    hash_account_email_change_token,
)
from app.features.mail.models import EmailTemplateName
from app.features.mail.service import (
    cancel_pending_source_emails,
    email_idempotency_key,
    enqueue_email,
)

ACTIVE_EMAIL_CHANGE_STATUSES = (
    AccountEmailChangeStatus.PENDING_VERIFICATION.value,
    AccountEmailChangeStatus.VERIFIED.value,
)
PENDING_EMAIL_CHANGE_TEMPLATES = (
    EmailTemplateName.ACCOUNT_EMAIL_CHANGE_VERIFICATION,
    EmailTemplateName.ACCOUNT_EMAIL_CHANGE_REQUEST_NOTICE,
)


class AccountEmailChangeError(ValueError):
    pass


@dataclass(frozen=True)
class AccountEmailChangeVerificationDetails:
    account_id: str
    display_name: str
    requested_email: str
    status: str


def _now() -> datetime:
    return datetime.now(UTC)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


async def get_active_account_email_change_request(
    db: AsyncSession,
    account_id: str,
    *,
    lock: bool = False,
) -> AccountEmailChangeRequest | None:
    statement = (
        select(AccountEmailChangeRequest)
        .where(
            AccountEmailChangeRequest.account_id == account_id,
            AccountEmailChangeRequest.status.in_(ACTIVE_EMAIL_CHANGE_STATUSES),
        )
        .order_by(AccountEmailChangeRequest.created_at.desc())
        .limit(1)
    )
    if lock:
        statement = statement.with_for_update().execution_options(populate_existing=True)
    return cast(AccountEmailChangeRequest | None, await db.scalar(statement))


async def request_account_email_change(
    db: AsyncSession,
    *,
    account_id: str,
    requested_email: str,
    requested_by: Account,
) -> tuple[Account, AccountEmailChangeRequest]:
    account = await db.scalar(
        select(Account)
        .where(Account.id == account_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if account is None or account.status != AccountStatus.ACTIVE or account.activated_at is None:
        raise AccountEmailChangeError(
            "Only active, activated accounts can request a verified email change."
        )
    if account.is_protected_system_account:
        raise AccountEmailChangeError("The protected bootstrap account email cannot be changed.")

    normalized_email = requested_email.strip().lower()
    if normalized_email == account.email.lower():
        raise AccountEmailChangeError("This email address is already active.")
    existing_account = await db.scalar(
        select(Account).where(Account.email == normalized_email, Account.id != account.id)
    )
    if existing_account is not None:
        raise AccountEmailChangeError("Email is already in use.")
    existing_request_for_email = await db.scalar(
        select(AccountEmailChangeRequest).where(
            AccountEmailChangeRequest.requested_email == normalized_email,
            AccountEmailChangeRequest.account_id != account.id,
            AccountEmailChangeRequest.status.in_(ACTIVE_EMAIL_CHANGE_STATUSES),
        )
    )
    if existing_request_for_email is not None:
        raise AccountEmailChangeError("This email already has a pending ownership request.")

    now = _now()
    previous_request = await get_active_account_email_change_request(
        db,
        account.id,
        lock=True,
    )
    if previous_request is not None:
        previous_request.status = AccountEmailChangeStatus.REPLACED.value
        previous_request.token_hash = None
        previous_request.invalidated_at = now
        previous_request.resolved_at = now
        await _cancel_request_emails(
            db,
            previous_request.id,
            reason="A newer email ownership request replaced this request.",
        )

    settings = get_settings()
    request_id = secrets.token_urlsafe(32)
    raw_token = derive_account_email_change_token(request_id)
    expires_at = now + timedelta(hours=settings.account_email_change_ttl_hours)
    request = AccountEmailChangeRequest(
        id=request_id,
        account_id=account.id,
        old_email=account.email.lower(),
        requested_email=normalized_email,
        token_hash=hash_account_email_change_token(raw_token),
        status=AccountEmailChangeStatus.PENDING_VERIFICATION.value,
        expires_at=expires_at,
        requested_by_account_id=requested_by.id,
        requested_by_name=requested_by.display_name,
        requested_by_role=requested_by.role.value,
    )
    db.add(request)
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise AccountEmailChangeError(
            "This account or email already has a pending ownership request."
        ) from exc

    expires_label = format_philippine_datetime(expires_at)
    common_payload = {
        "requestId": request.id,
        "displayName": account.display_name,
        "role": account.role.value,
        "enterpriseId": (
            account.enterprise_profile.enterprise_id
            if account.enterprise_profile is not None
            else ""
        ),
        "oldEmail": request.old_email,
        "newEmail": request.requested_email,
        "expiresLabel": expires_label,
    }
    await enqueue_email(
        db,
        account_id=account.id,
        source_id=request.id,
        recipient=request.requested_email,
        template_name=EmailTemplateName.ACCOUNT_EMAIL_CHANGE_VERIFICATION,
        template_payload={
            **common_payload,
            "email": request.requested_email,
            "frontendPublicUrl": settings.frontend_public_url,
        },
        idempotency_key=email_idempotency_key("email-change-verify", request.id),
        tags={"category": "account_email_change_verification"},
        valid_until=request.expires_at,
    )
    await enqueue_email(
        db,
        account_id=account.id,
        source_id=request.id,
        recipient=request.old_email,
        template_name=EmailTemplateName.ACCOUNT_EMAIL_CHANGE_REQUEST_NOTICE,
        template_payload={**common_payload, "email": request.old_email},
        idempotency_key=email_idempotency_key("email-change-notice", request.id),
        tags={"category": "account_email_change_request_notice"},
        valid_until=request.expires_at,
    )
    return account, request


async def verify_account_email_change(
    db: AsyncSession,
    raw_token: str,
    *,
    commit: bool = True,
) -> AccountEmailChangeVerificationDetails:
    normalized_token = raw_token.strip()
    if not normalized_token:
        raise AccountEmailChangeError("Email verification link is invalid or expired.")
    token_hash = hash_account_email_change_token(normalized_token)
    candidate = await db.scalar(
        select(AccountEmailChangeRequest).where(AccountEmailChangeRequest.token_hash == token_hash)
    )
    if candidate is None:
        raise AccountEmailChangeError("Email verification link is invalid or expired.")

    account = await db.scalar(
        select(Account)
        .where(Account.id == candidate.account_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    request = await db.scalar(
        select(AccountEmailChangeRequest)
        .where(AccountEmailChangeRequest.id == candidate.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    now = _now()
    if (
        account is None
        or request is None
        or request.status != AccountEmailChangeStatus.PENDING_VERIFICATION.value
        or request.token_hash is None
        or not hmac.compare_digest(request.token_hash, token_hash)
        or account.status != AccountStatus.ACTIVE
        or account.activated_at is None
        or account.email.lower() != request.old_email
    ):
        raise AccountEmailChangeError("Email verification link is invalid or expired.")
    if _as_utc(request.expires_at) <= now:
        await _expire_request(db, request, now=now)
        await db.commit()
        raise AccountEmailChangeError("Email verification link is invalid or expired.")

    request.status = AccountEmailChangeStatus.VERIFIED.value
    request.verified_at = now
    request.token_hash = None
    await cancel_pending_source_emails(
        db,
        template_name=EmailTemplateName.ACCOUNT_EMAIL_CHANGE_VERIFICATION,
        source_ids=[request.id],
        reason="The proposed account email was already verified.",
    )
    if commit:
        await db.commit()
    else:
        await db.flush()
    return AccountEmailChangeVerificationDetails(
        account_id=account.id,
        display_name=account.display_name,
        requested_email=request.requested_email,
        status=request.status,
    )


async def resolve_account_email_change(
    db: AsyncSession,
    *,
    account_id: str,
    actor: Account,
    approve: bool,
    commit: bool = True,
) -> tuple[Account, AccountEmailChangeRequest]:
    account = await db.scalar(
        select(Account)
        .where(Account.id == account_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if account is None:
        raise AccountEmailChangeError("Account not found.")
    request = await get_active_account_email_change_request(db, account.id, lock=True)
    if request is None:
        raise AccountEmailChangeError("Email change request not found.")

    now = _now()
    if _as_utc(request.expires_at) <= now:
        await _expire_request(db, request, now=now)
        await db.commit()
        raise AccountEmailChangeError("The email ownership request expired.")

    if not approve:
        request.status = AccountEmailChangeStatus.REJECTED.value
        request.token_hash = None
        request.invalidated_at = now
        request.resolved_at = now
        request.resolved_by_account_id = actor.id
        request.resolved_by_name = actor.display_name
        await _cancel_request_emails(
            db,
            request.id,
            reason="TANAW IT rejected this email ownership request.",
        )
        if commit:
            await db.commit()
            await db.refresh(account)
        else:
            await db.flush()
        return account, request

    if account.status != AccountStatus.ACTIVE or account.activated_at is None:
        raise AccountEmailChangeError(
            "The account must remain active and activated before its email can change."
        )
    if request.status != AccountEmailChangeStatus.VERIFIED.value:
        raise AccountEmailChangeError(
            "The proposed email owner must open the verification link before IT can approve it."
        )
    if actor.id in {request.requested_by_account_id, account.id}:
        raise AccountEmailChangeError(
            "A different IT Personnel account must approve this email change."
        )
    if account.email.lower() != request.old_email:
        raise AccountEmailChangeError("The account email changed after this request was created.")
    existing_account = await db.scalar(
        select(Account).where(
            Account.email == request.requested_email,
            Account.id != account.id,
        )
    )
    if existing_account is not None:
        raise AccountEmailChangeError("Email is already in use.")

    account.email = request.requested_email
    account.token_invalid_before = now
    request.status = AccountEmailChangeStatus.APPROVED.value
    request.resolved_at = now
    request.resolved_by_account_id = actor.id
    request.resolved_by_name = actor.display_name
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise AccountEmailChangeError("Email is already in use.") from exc
    await invalidate_password_reset_challenges(db, account.id, invalidated_at=now)
    await _cancel_request_emails(
        db,
        request.id,
        reason="The verified account email change was resolved.",
    )

    common_payload = {
        "requestId": request.id,
        "displayName": account.display_name,
        "role": account.role.value,
        "enterpriseId": (
            account.enterprise_profile.enterprise_id
            if account.enterprise_profile is not None
            else ""
        ),
        "oldEmail": request.old_email,
        "newEmail": request.requested_email,
    }
    notification_valid_until = now + timedelta(hours=24)
    await enqueue_email(
        db,
        account_id=account.id,
        source_id=request.id,
        recipient=request.old_email,
        template_name=EmailTemplateName.ACCOUNT_EMAIL_CHANGE_APPROVED_OLD,
        template_payload={**common_payload, "email": request.old_email},
        idempotency_key=email_idempotency_key("email-change-approved-old", request.id),
        tags={"category": "account_email_change_approved_old"},
        valid_until=notification_valid_until,
    )
    await enqueue_email(
        db,
        account_id=account.id,
        source_id=request.id,
        recipient=request.requested_email,
        template_name=EmailTemplateName.ACCOUNT_EMAIL_CHANGE_APPROVED_NEW,
        template_payload={**common_payload, "email": request.requested_email},
        idempotency_key=email_idempotency_key("email-change-approved-new", request.id),
        tags={"category": "account_email_change_approved_new"},
        valid_until=notification_valid_until,
    )
    if commit:
        await db.commit()
        await db.refresh(account)
    else:
        await db.flush()
    return account, request


async def cancel_account_email_change(
    db: AsyncSession,
    *,
    account_id: str,
    commit: bool = True,
) -> AccountEmailChangeRequest:
    account = await db.scalar(
        select(Account)
        .where(Account.id == account_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if account is None:
        raise AccountEmailChangeError("Account not found.")
    request = await get_active_account_email_change_request(db, account.id, lock=True)
    if request is None:
        raise AccountEmailChangeError("Email change request not found.")
    now = _now()
    request.status = AccountEmailChangeStatus.CANCELLED.value
    request.token_hash = None
    request.invalidated_at = now
    request.resolved_at = now
    await _cancel_request_emails(
        db,
        request.id,
        reason="The account owner cancelled this email ownership request.",
    )
    if commit:
        await db.commit()
    else:
        await db.flush()
    return request


async def invalidate_account_email_change_requests(
    db: AsyncSession,
    account_id: str,
    *,
    invalidated_at: datetime,
    reason: str,
) -> None:
    request = await get_active_account_email_change_request(db, account_id, lock=True)
    if request is None:
        return
    request.status = AccountEmailChangeStatus.CANCELLED.value
    request.token_hash = None
    request.invalidated_at = invalidated_at
    request.resolved_at = invalidated_at
    await _cancel_request_emails(db, request.id, reason=reason)


async def _expire_request(
    db: AsyncSession,
    request: AccountEmailChangeRequest,
    *,
    now: datetime,
) -> None:
    request.status = AccountEmailChangeStatus.EXPIRED.value
    request.token_hash = None
    request.invalidated_at = now
    request.resolved_at = now
    await _cancel_request_emails(
        db,
        request.id,
        reason="The email ownership request expired.",
    )


async def _cancel_request_emails(
    db: AsyncSession,
    request_id: str,
    *,
    reason: str,
) -> None:
    for template_name in PENDING_EMAIL_CHANGE_TEMPLATES:
        await cancel_pending_source_emails(
            db,
            template_name=template_name,
            source_ids=[request_id],
            reason=reason,
        )
