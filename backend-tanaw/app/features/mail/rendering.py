import hmac
import json
from datetime import UTC, datetime
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import (
    Account,
    AccountEmailChangeRequest,
    AccountEmailChangeStatus,
    AccountRole,
    AccountStatus,
)
from app.features.auth.models import AccountActivationToken, PasswordResetChallenge
from app.features.auth.secret_values import (
    derive_account_activation_token,
    derive_account_email_change_token,
    derive_password_reset_code,
    hash_account_email_change_token,
)
from app.features.mail.models import EmailOutbox, EmailTemplateName
from app.features.mail.templates import (
    EmailContent,
    EmailRecipient,
    account_activation_email,
    account_email_change_approved_email,
    account_email_change_request_notice_email,
    account_email_change_verification_email,
    business_email_change_email,
    password_reset_code_email,
    support_ticket_reply_email,
)
from app.features.operational.models import SupportTicket, SupportTicketMessage


class EmailRenderCancelled(ValueError):
    pass


async def render_outbox_email(db: AsyncSession, outbox: EmailOutbox) -> EmailContent:
    payload = _load_payload(outbox.template_payload_json)
    try:
        template_name = EmailTemplateName(outbox.template_name)
    except ValueError as exc:
        raise EmailRenderCancelled("Unknown email template.") from exc
    if outbox.template_version != "v1":
        raise EmailRenderCancelled("Unknown email template version.")
    if outbox.secret_version != "v1":
        raise EmailRenderCancelled("Unknown email secret version.")

    if template_name == EmailTemplateName.ACCOUNT_ACTIVATION:
        return await _render_account_activation(db, outbox, payload)
    if template_name == EmailTemplateName.PASSWORD_RESET:
        return await _render_password_reset(db, outbox, payload)
    if template_name == EmailTemplateName.BUSINESS_EMAIL_CHANGE:
        return await _render_business_email_change(db, outbox, payload)
    if template_name == EmailTemplateName.ACCOUNT_EMAIL_CHANGE_VERIFICATION:
        return await _render_account_email_change_verification(db, outbox, payload)
    if template_name == EmailTemplateName.ACCOUNT_EMAIL_CHANGE_REQUEST_NOTICE:
        return await _render_account_email_change_request_notice(db, outbox, payload)
    if template_name in {
        EmailTemplateName.ACCOUNT_EMAIL_CHANGE_APPROVED_OLD,
        EmailTemplateName.ACCOUNT_EMAIL_CHANGE_APPROVED_NEW,
    }:
        return await _render_account_email_change_approved(db, outbox, payload)
    if template_name == EmailTemplateName.SUPPORT_REPLY:
        return await _render_support_reply(db, outbox, payload)
    raise EmailRenderCancelled("Unknown email template.")


async def _render_account_activation(
    db: AsyncSession, outbox: EmailOutbox, payload: dict[str, str]
) -> EmailContent:
    token_id = _required(payload, "tokenId")
    token = await db.scalar(
        select(AccountActivationToken).where(AccountActivationToken.id == token_id)
    )
    account = await db.scalar(select(Account).where(Account.id == outbox.account_id))
    now = datetime.now(UTC)
    if (
        token is None
        or account is None
        or token.account_id != account.id
        or token.consumed_at is not None
        or token.invalidated_at is not None
        or _as_utc(token.expires_at) <= now
        or account.status != AccountStatus.ACTIVE
        or account.activated_at is not None
        or account.email.lower() != outbox.recipient
    ):
        raise EmailRenderCancelled("The activation request is no longer valid.")

    raw_token = derive_account_activation_token(token.id)
    frontend_public_url = _required(payload, "frontendPublicUrl").rstrip("/")
    activation_url = f"{frontend_public_url}/activate-account#token={quote(raw_token)}"
    return account_activation_email(
        _recipient_from_payload(payload),
        activation_url,
        _required(payload, "expiresLabel"),
    )


async def _render_password_reset(
    db: AsyncSession, outbox: EmailOutbox, payload: dict[str, str]
) -> EmailContent:
    challenge_id = _required(payload, "challengeId")
    challenge = await db.scalar(
        select(PasswordResetChallenge).where(PasswordResetChallenge.id == challenge_id)
    )
    account = await db.scalar(select(Account).where(Account.id == outbox.account_id))
    now = datetime.now(UTC)
    if (
        challenge is None
        or account is None
        or challenge.account_id != account.id
        or challenge.used
        or challenge.code_consumed
        or _as_utc(challenge.expires_at) <= now
        or account.status != AccountStatus.ACTIVE
        or account.activated_at is None
        or account.email.lower() != outbox.recipient
    ):
        raise EmailRenderCancelled("The password recovery request is no longer valid.")

    return password_reset_code_email(
        _recipient_from_payload(payload),
        derive_password_reset_code(challenge.id),
        _required(payload, "expiresLabel"),
    )


async def _render_business_email_change(
    db: AsyncSession, outbox: EmailOutbox, payload: dict[str, str]
) -> EmailContent:
    account = await db.scalar(select(Account).where(Account.id == outbox.account_id))
    new_email = _required(payload, "newEmail").lower()
    if account is None or new_email != outbox.recipient:
        raise EmailRenderCancelled("The business email request is no longer valid.")
    return business_email_change_email(_recipient_from_payload(payload), new_email)


async def _render_account_email_change_verification(
    db: AsyncSession,
    outbox: EmailOutbox,
    payload: dict[str, str],
) -> EmailContent:
    request, account = await _email_change_source(db, outbox, payload)
    now = datetime.now(UTC)
    if (
        request.status != AccountEmailChangeStatus.PENDING_VERIFICATION.value
        or request.token_hash is None
        or _as_utc(request.expires_at) <= now
        or account.status != AccountStatus.ACTIVE
        or account.activated_at is None
        or account.email.lower() != request.old_email
        or outbox.recipient != request.requested_email
    ):
        raise EmailRenderCancelled("The email ownership request is no longer valid.")
    raw_token = derive_account_email_change_token(request.id)
    if not hmac.compare_digest(
        request.token_hash,
        hash_account_email_change_token(raw_token),
    ):
        raise EmailRenderCancelled("The email ownership request is no longer valid.")
    frontend_public_url = _required(payload, "frontendPublicUrl").rstrip("/")
    verification_url = f"{frontend_public_url}/verify-email-change#token={quote(raw_token)}"
    return account_email_change_verification_email(
        _recipient_from_payload(payload),
        old_email=request.old_email,
        new_email=request.requested_email,
        verification_url=verification_url,
        expires_label=_required(payload, "expiresLabel"),
    )


async def _render_account_email_change_request_notice(
    db: AsyncSession,
    outbox: EmailOutbox,
    payload: dict[str, str],
) -> EmailContent:
    request, account = await _email_change_source(db, outbox, payload)
    if (
        request.status
        not in {
            AccountEmailChangeStatus.PENDING_VERIFICATION.value,
            AccountEmailChangeStatus.VERIFIED.value,
        }
        or account.email.lower() != request.old_email
        or outbox.recipient != request.old_email
    ):
        raise EmailRenderCancelled("The email ownership request is no longer valid.")
    return account_email_change_request_notice_email(
        _recipient_from_payload(payload),
        new_email=request.requested_email,
        expires_label=_required(payload, "expiresLabel"),
    )


async def _render_account_email_change_approved(
    db: AsyncSession,
    outbox: EmailOutbox,
    payload: dict[str, str],
) -> EmailContent:
    request, _ = await _email_change_source(db, outbox, payload)
    sent_to_old_address = (
        outbox.template_name == EmailTemplateName.ACCOUNT_EMAIL_CHANGE_APPROVED_OLD.value
    )
    expected_recipient = request.old_email if sent_to_old_address else request.requested_email
    if (
        request.status != AccountEmailChangeStatus.APPROVED.value
        or outbox.recipient != expected_recipient
    ):
        raise EmailRenderCancelled("The approved email-change notice is no longer valid.")
    return account_email_change_approved_email(
        _recipient_from_payload(payload),
        old_email=request.old_email,
        new_email=request.requested_email,
        sent_to_old_address=sent_to_old_address,
    )


async def _email_change_source(
    db: AsyncSession,
    outbox: EmailOutbox,
    payload: dict[str, str],
) -> tuple[AccountEmailChangeRequest, Account]:
    request_id = _required(payload, "requestId")
    request = await db.scalar(
        select(AccountEmailChangeRequest).where(AccountEmailChangeRequest.id == request_id)
    )
    account = await db.scalar(select(Account).where(Account.id == outbox.account_id))
    if (
        request is None
        or account is None
        or request.account_id != account.id
        or request.old_email != _required(payload, "oldEmail").lower()
        or request.requested_email != _required(payload, "newEmail").lower()
    ):
        raise EmailRenderCancelled("The email ownership request is no longer valid.")
    return request, account


async def _render_support_reply(
    db: AsyncSession, outbox: EmailOutbox, payload: dict[str, str]
) -> EmailContent:
    ticket_id = _required(payload, "ticketId")
    message_id = _required(payload, "messageId")
    ticket = await db.scalar(select(SupportTicket).where(SupportTicket.id == ticket_id))
    message = await db.scalar(
        select(SupportTicketMessage).where(
            SupportTicketMessage.id == message_id,
            SupportTicketMessage.ticket_id == ticket_id,
        )
    )
    if ticket is None or message is None or ticket.enterprise_profile_id != outbox.account_id:
        raise EmailRenderCancelled("The support reply is no longer available.")
    return support_ticket_reply_email(
        ticket_code=ticket.ticket_code,
        subject=ticket.subject,
        recipient_name=_required(payload, "recipientName"),
        author_name=message.author_name,
        message=message.message,
    )


def _load_payload(value: str) -> dict[str, str]:
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as exc:
        raise EmailRenderCancelled("Invalid email template payload.") from exc
    if not isinstance(payload, dict) or any(
        not isinstance(key, str) or not isinstance(item, str) for key, item in payload.items()
    ):
        raise EmailRenderCancelled("Invalid email template payload.")
    return payload


def _required(payload: dict[str, str], key: str) -> str:
    value = payload.get(key, "").strip()
    if not value:
        raise EmailRenderCancelled("Invalid email template payload.")
    return value


def _recipient_from_payload(payload: dict[str, str]) -> EmailRecipient:
    try:
        role = AccountRole(_required(payload, "role"))
    except ValueError as exc:
        raise EmailRenderCancelled("Invalid email template payload.") from exc
    return EmailRecipient(
        display_name=_required(payload, "displayName"),
        email=_required(payload, "email"),
        role=role,
        enterprise_id=payload.get("enterpriseId") or None,
    )


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
