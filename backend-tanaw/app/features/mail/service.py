import json
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.features.mail.models import EmailOutbox, EmailOutboxStatus, EmailTemplateName

REDACTED_EMAIL_BODY = "[Sensitive email content is not retained in production delivery logs.]"
BREVO_IDEMPOTENCY_WINDOW = timedelta(minutes=30)
MANUAL_RETRY_SAFETY_MARGIN = timedelta(minutes=2)


class EmailOutboxRetryError(ValueError):
    pass


async def enqueue_email(
    db: AsyncSession,
    *,
    account_id: str,
    source_id: str,
    recipient: str,
    template_name: EmailTemplateName,
    template_payload: dict[str, str],
    idempotency_key: str,
    tags: dict[str, str] | None = None,
    valid_until: datetime | None = None,
) -> EmailOutbox:
    settings = get_settings()
    now = datetime.now(UTC)
    outbox = EmailOutbox(
        id=str(uuid4()),
        account_id=account_id,
        purpose=(tags or {}).get("category", template_name.value),
        source_id=source_id,
        recipient=recipient.strip().lower(),
        sender=f"{settings.email_from_name} <{settings.email_from_address}>",
        template_name=template_name.value,
        template_version="v1",
        secret_version="v1",
        template_payload_json=json.dumps(template_payload, sort_keys=True, separators=(",", ":")),
        tags_json=(
            json.dumps(tags, sort_keys=True, separators=(",", ":")) if tags is not None else None
        ),
        idempotency_key=idempotency_key,
        provider="brevo" if settings.email_delivery_mode == "brevo" else "local",
        status=EmailOutboxStatus.QUEUED.value,
        attempt_count=0,
        max_attempts=settings.email_outbox_max_attempts,
        next_attempt_at=now,
        valid_until=valid_until,
        outcome_uncertain=False,
        manual_retry_count=0,
    )
    db.add(outbox)
    await db.flush()
    return outbox


async def list_email_outbox(db: AsyncSession, *, limit: int = 250) -> list[EmailOutbox]:
    result = await db.scalars(
        select(EmailOutbox).order_by(EmailOutbox.created_at.desc()).limit(limit)
    )
    return list(result)


async def get_email_outbox(db: AsyncSession, outbox_id: str) -> EmailOutbox | None:
    return cast(
        EmailOutbox | None,
        await db.scalar(select(EmailOutbox).where(EmailOutbox.id == outbox_id)),
    )


async def cancel_pending_source_emails(
    db: AsyncSession,
    *,
    template_name: EmailTemplateName,
    source_ids: list[str],
    reason: str,
) -> None:
    if not source_ids:
        return
    await db.execute(
        update(EmailOutbox)
        .where(
            EmailOutbox.template_name == template_name.value,
            EmailOutbox.source_id.in_(source_ids),
            EmailOutbox.status.in_(
                (
                    EmailOutboxStatus.QUEUED.value,
                    EmailOutboxStatus.RETRY_SCHEDULED.value,
                )
            ),
        )
        .values(
            status=EmailOutboxStatus.CANCELLED.value,
            lock_token=None,
            locked_at=None,
            lock_expires_at=None,
            last_error_code="source_invalidated",
            last_error_message=reason,
            outcome_uncertain=False,
        )
    )
    await db.execute(
        update(EmailOutbox)
        .where(
            EmailOutbox.template_name == template_name.value,
            EmailOutbox.source_id.in_(source_ids),
            EmailOutbox.status == EmailOutboxStatus.PROCESSING.value,
        )
        .values(
            status=EmailOutboxStatus.RECONCILIATION_REQUIRED.value,
            lock_token=None,
            locked_at=None,
            lock_expires_at=None,
            last_error_code="source_invalidated_during_delivery",
            last_error_message=(f"{reason} The provider outcome may require reconciliation."),
            outcome_uncertain=True,
        )
    )


async def retry_terminal_email(db: AsyncSession, outbox_id: str) -> EmailOutbox:
    outbox = await db.scalar(
        select(EmailOutbox).where(EmailOutbox.id == outbox_id).with_for_update()
    )
    if outbox is None:
        raise EmailOutboxRetryError("Email delivery record not found.")
    if outbox.status != EmailOutboxStatus.TERMINAL_FAILED.value:
        raise EmailOutboxRetryError("Only terminally failed email can be retried manually.")
    if outbox.provider != "brevo":
        raise EmailOutboxRetryError(
            "Only Brevo delivery records can be retried through this endpoint."
        )

    now = datetime.now(UTC)
    if outbox.valid_until is not None and _as_utc(outbox.valid_until) <= now:
        raise EmailOutboxRetryError(
            "This email request has expired. Issue a new activation, recovery, or support message."
        )
    if outbox.first_provider_attempt_at is not None and now >= (
        _as_utc(outbox.first_provider_attempt_at)
        + BREVO_IDEMPOTENCY_WINDOW
        - MANUAL_RETRY_SAFETY_MARGIN
    ):
        raise EmailOutboxRetryError(
            "This delivery is outside Brevo's safe idempotency window. "
            "Issue a new activation, recovery, or support message instead."
        )

    outbox.status = EmailOutboxStatus.QUEUED.value
    outbox.max_attempts = max(outbox.max_attempts, outbox.attempt_count + 1)
    outbox.manual_retry_count += 1
    outbox.next_attempt_at = now
    outbox.lock_token = None
    outbox.locked_at = None
    outbox.lock_expires_at = None
    outbox.last_error_code = None
    outbox.last_error_message = None
    await db.flush()
    await db.refresh(outbox)
    return outbox


def email_idempotency_key(purpose: str, source_id: str | None = None) -> str:
    suffix = source_id or str(uuid4())
    return f"tanaw-{purpose}-{suffix}"[:256]


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
