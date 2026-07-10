from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.features.accounts.models import (
    DeliveryStatus,
    DevDelivery,
)
from app.features.mail.client import ResendAPIError, ResendClient
from app.features.mail.templates import EmailContent

REDACTED_EMAIL_BODY = "[Sensitive email content is not retained in production delivery logs.]"


class EmailDeliveryError(RuntimeError):
    pass


async def deliver_email(
    db: AsyncSession,
    *,
    account_id: str,
    recipient: str,
    content: EmailContent,
    idempotency_key: str,
    reply_to: str | None = None,
    tags: dict[str, str] | None = None,
    raise_on_failure: bool = True,
) -> DevDelivery:
    settings = get_settings()
    normalized_recipient = recipient.strip().lower()
    if settings.email_delivery_mode == "log":
        if settings.is_production:
            delivery = DevDelivery(
                account_id=account_id,
                recipient=normalized_recipient,
                subject=content.subject,
                body=REDACTED_EMAIL_BODY,
                provider="local",
                error_message="EMAIL_DELIVERY_MODE=log is disabled in production.",
                status=DeliveryStatus.FAILED,
            )
            db.add(delivery)
            if raise_on_failure:
                raise EmailDeliveryError(delivery.error_message)
            return delivery
        delivery = DevDelivery(
            account_id=account_id,
            recipient=normalized_recipient,
            subject=content.subject,
            body=content.text,
            provider="local",
            status=DeliveryStatus.RECORDED,
        )
        db.add(delivery)
        return delivery

    error = _validate_resend_delivery(settings, normalized_recipient)
    provider_message_id: str | None = None
    if error is None:
        try:
            sender = f"{settings.email_from_name} <{settings.email_from_address}>"
            sent = await _resend_client(settings).send_email(
                sender=sender,
                recipient=normalized_recipient,
                subject=content.subject,
                text=content.text,
                html=content.html,
                reply_to=reply_to or settings.email_reply_to,
                idempotency_key=idempotency_key,
                tags=tags,
            )
            provider_message_id = sent.id
        except ResendAPIError as exc:
            error = str(exc)

    delivery = DevDelivery(
        account_id=account_id,
        recipient=normalized_recipient,
        subject=content.subject,
        body=REDACTED_EMAIL_BODY,
        provider="resend",
        provider_message_id=provider_message_id,
        error_message=error,
        status=DeliveryStatus.FAILED if error else DeliveryStatus.SENT,
    )
    db.add(delivery)
    if error and raise_on_failure:
        raise EmailDeliveryError(error)
    return delivery


def _validate_resend_delivery(settings: Settings, recipient: str) -> str | None:
    if not settings.resend_api_key:
        return "RESEND_API_KEY is not configured."
    if settings.email_test_recipient and recipient != settings.email_test_recipient.lower():
        return (
            "The Resend development sender can only deliver to the configured "
            "EMAIL_TEST_RECIPIENT until a custom domain is verified."
        )
    return None


def _resend_client(settings: Settings | None = None) -> ResendClient:
    resolved = settings or get_settings()
    if not resolved.resend_api_key:
        raise EmailDeliveryError("RESEND_API_KEY is not configured.")
    return ResendClient(
        resolved.resend_api_key,
        base_url=resolved.resend_api_base_url,
        timeout_seconds=resolved.email_request_timeout_seconds,
    )


def email_idempotency_key(purpose: str, source_id: str | None = None) -> str:
    suffix = source_id or str(uuid4())
    return f"tanaw-{purpose}-{suffix}"[:256]
