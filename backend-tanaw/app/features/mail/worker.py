import asyncio
import hashlib
import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import uuid4

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.db.session import AsyncSessionLocal
from app.features.accounts.models import AccountRole
from app.features.mail.client import BrevoAPIError
from app.features.mail.dev_log import record_dev_delivery
from app.features.mail.models import EmailDeliveryAttempt, EmailOutbox, EmailOutboxStatus
from app.features.mail.rendering import EmailRenderCancelled, render_outbox_email
from app.features.mail.runtime import EmailRuntimeError, get_brevo_client
from app.features.mail.service import (
    BREVO_IDEMPOTENCY_WINDOW,
    MANUAL_RETRY_SAFETY_MARGIN,
    REDACTED_EMAIL_BODY,
)
from app.features.mail.templates import EmailContent
from app.features.notifications.service import (
    create_role_notifications,
    mark_source_notifications_read,
)

logger = logging.getLogger("uvicorn.error")
_worker_task: asyncio.Task[None] | None = None
_worker_stop_event: asyncio.Event | None = None


@dataclass(frozen=True)
class ClaimedEmail:
    id: str
    lock_token: str


class EmailDispatchRejected(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        error_code: str,
        status: EmailOutboxStatus = EmailOutboxStatus.TERMINAL_FAILED,
        outcome_uncertain: bool = False,
    ) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.status = status
        self.outcome_uncertain = outcome_uncertain


async def start_email_outbox_worker(settings: Settings) -> None:
    global _worker_stop_event, _worker_task
    await stop_email_outbox_worker()
    _worker_stop_event = asyncio.Event()
    _worker_task = asyncio.create_task(
        _worker_loop(settings, _worker_stop_event),
        name="tanaw-email-outbox",
    )


async def stop_email_outbox_worker() -> None:
    global _worker_stop_event, _worker_task
    stop_event = _worker_stop_event
    task = _worker_task
    _worker_stop_event = None
    _worker_task = None
    if stop_event is not None:
        stop_event.set()
    if task is not None:
        await task


def email_outbox_worker_ready() -> bool:
    return _worker_task is not None and not _worker_task.done()


async def run_email_outbox_batch(settings: Settings) -> int:
    claims = await _claim_email_batch(settings)
    if claims:
        await asyncio.gather(*(_dispatch_claim(settings, claim) for claim in claims))
    return len(claims)


async def _worker_loop(settings: Settings, stop_event: asyncio.Event) -> None:
    while not stop_event.is_set():
        try:
            processed = await run_email_outbox_batch(settings)
        except Exception:
            processed = 0
            logger.exception("Email outbox worker batch failed.")
        if processed > 0:
            continue
        try:
            await asyncio.wait_for(
                stop_event.wait(),
                timeout=settings.email_outbox_poll_interval_seconds,
            )
        except TimeoutError:
            pass


async def _claim_email_batch(settings: Settings) -> list[ClaimedEmail]:
    now = datetime.now(UTC)
    lease_expires_at = now + timedelta(seconds=settings.email_outbox_lease_seconds)
    async with AsyncSessionLocal() as db:
        result = await db.scalars(
            select(EmailOutbox)
            .where(
                or_(
                    (
                        EmailOutbox.status.in_(
                            (
                                EmailOutboxStatus.QUEUED.value,
                                EmailOutboxStatus.RETRY_SCHEDULED.value,
                            )
                        )
                        & (EmailOutbox.next_attempt_at <= now)
                    ),
                    (
                        (EmailOutbox.status == EmailOutboxStatus.PROCESSING.value)
                        & (EmailOutbox.lock_expires_at <= now)
                    ),
                )
            )
            .order_by(EmailOutbox.next_attempt_at.asc(), EmailOutbox.created_at.asc())
            .with_for_update(skip_locked=True)
            .limit(settings.email_outbox_batch_size)
        )
        outbox_items = list(result)
        claims: list[ClaimedEmail] = []
        for outbox in outbox_items:
            lock_token = str(uuid4())
            outbox.status = EmailOutboxStatus.PROCESSING.value
            outbox.attempt_count += 1
            outbox.lock_token = lock_token
            outbox.locked_at = now
            outbox.lock_expires_at = lease_expires_at
            claims.append(ClaimedEmail(id=outbox.id, lock_token=lock_token))
        await db.commit()
        return claims


async def _dispatch_claim(settings: Settings, claim: ClaimedEmail) -> None:
    attempt_started_at = datetime.now(UTC)
    try:
        async with AsyncSessionLocal() as db:
            outbox = await _get_claimed_email(db, claim)
            if outbox is None:
                return
            if outbox.valid_until is not None and datetime.now(UTC) >= _as_utc(outbox.valid_until):
                raise EmailDispatchRejected(
                    "The email request expired before delivery.",
                    error_code="request_expired",
                    status=EmailOutboxStatus.EXPIRED,
                )
            content = await render_outbox_email(db, outbox)
            recipient = outbox.recipient
            idempotency_key = outbox.idempotency_key
            tags = _load_tags(outbox.tags_json)
            account_id = outbox.account_id
            sender = outbox.sender
            delivery_provider = outbox.provider

        if delivery_provider == "local":
            await _record_success(
                settings,
                claim,
                account_id=account_id,
                recipient=recipient,
                content=content,
                provider="local",
                provider_message_id=None,
                delivery_status="recorded",
                outbox_status=EmailOutboxStatus.RECORDED,
                retained_body=content.text,
                attempt_started_at=attempt_started_at,
            )
            return

        if delivery_provider != "brevo":
            raise EmailDispatchRejected(
                "This email delivery has an unsupported provider.",
                error_code="unsupported_provider",
                status=EmailOutboxStatus.RECONCILIATION_REQUIRED,
                outcome_uncertain=True,
            )

        _validate_brevo_configuration(settings)
        provider_payload_hash = _provider_payload_hash(
            sender=sender,
            recipient=recipient,
            content=content,
            tags=tags,
        )
        attempt_started_at = await _prepare_provider_attempt(
            settings,
            claim,
            provider_payload_hash=provider_payload_hash,
        )
        sent = await get_brevo_client().send_email(
            sender=sender,
            recipient=recipient,
            subject=content.subject,
            text=content.text,
            html=content.html,
            idempotency_key=idempotency_key,
            tags=tags,
        )
        await _record_success(
            settings,
            claim,
            account_id=account_id,
            recipient=recipient,
            content=content,
            provider="brevo",
            provider_message_id=sent.id,
            delivery_status="accepted",
            outbox_status=EmailOutboxStatus.ACCEPTED,
            retained_body=REDACTED_EMAIL_BODY,
            attempt_started_at=attempt_started_at,
        )
    except EmailRenderCancelled as exc:
        await _record_cancelled(claim, str(exc))
    except BrevoAPIError as exc:
        await _record_failure(
            settings,
            claim,
            retryable=exc.retryable,
            error_code=exc.error_type
            or (f"http_{exc.status_code}" if exc.status_code is not None else "network_error"),
            error_message=str(exc),
            retry_after_seconds=exc.retry_after_seconds,
            outcome_uncertain=exc.status_code is None or exc.duplicate,
            attempt_started_at=attempt_started_at,
            final_status=(EmailOutboxStatus.RECONCILIATION_REQUIRED if exc.duplicate else None),
        )
    except EmailDispatchRejected as exc:
        await _record_failure(
            settings,
            claim,
            retryable=False,
            error_code=exc.error_code,
            error_message=str(exc),
            outcome_uncertain=exc.outcome_uncertain,
            attempt_started_at=attempt_started_at,
            final_status=exc.status,
        )
    except EmailRuntimeError as exc:
        await _record_failure(
            settings,
            claim,
            retryable=False,
            error_code="configuration_error",
            error_message=str(exc),
            attempt_started_at=attempt_started_at,
        )
    except Exception:
        logger.exception("Unexpected email outbox dispatch failure outbox_id=%s", claim.id)
        await _record_failure(
            settings,
            claim,
            retryable=True,
            error_code="internal_error",
            error_message="TANAW could not complete this email delivery attempt.",
            outcome_uncertain=True,
            attempt_started_at=attempt_started_at,
        )


async def _record_success(
    settings: Settings,
    claim: ClaimedEmail,
    *,
    account_id: str,
    recipient: str,
    content: EmailContent,
    provider: str,
    provider_message_id: str | None,
    delivery_status: str,
    outbox_status: EmailOutboxStatus,
    retained_body: str,
    attempt_started_at: datetime,
) -> None:
    now = datetime.now(UTC)
    async with AsyncSessionLocal() as db:
        outbox = await _get_claimed_email(db, claim, lock=True)
        if outbox is None:
            return
        outbox.status = outbox_status.value
        outbox.provider_message_id = provider_message_id
        outbox.accepted_at = now
        outbox.last_error_code = None
        outbox.last_error_message = None
        outbox.outcome_uncertain = False
        _release_lease(outbox)
        db.add(
            _attempt_record(
                outbox,
                status=outbox_status.value,
                started_at=attempt_started_at,
                provider_message_id=provider_message_id,
            )
        )
        if not settings.is_production:
            record_dev_delivery(
                account_id=account_id,
                recipient=recipient,
                subject=content.subject,
                body=retained_body,
                status=delivery_status,
                created_at=now,
            )
        await db.commit()
        await _mark_email_problem_resolved(db, outbox.id)
    logger.info(
        "Email outbox completed outbox_id=%s provider=%s status=%s provider_message_id=%s",
        claim.id,
        provider,
        outbox_status.value,
        provider_message_id,
    )


async def _record_cancelled(claim: ClaimedEmail, reason: str) -> None:
    async with AsyncSessionLocal() as db:
        outbox = await _get_claimed_email(db, claim, lock=True)
        if outbox is None:
            return
        outbox.status = EmailOutboxStatus.CANCELLED.value
        outbox.last_error_code = "request_cancelled"
        outbox.last_error_message = reason[:1000]
        outbox.outcome_uncertain = False
        attempt_started_at = outbox.locked_at or datetime.now(UTC)
        _release_lease(outbox)
        db.add(
            _attempt_record(
                outbox,
                status=EmailOutboxStatus.CANCELLED.value,
                started_at=attempt_started_at,
                error_code="request_cancelled",
                error_message=reason,
            )
        )
        await db.commit()
    logger.info("Email outbox cancelled outbox_id=%s", claim.id)


async def _record_failure(
    settings: Settings,
    claim: ClaimedEmail,
    *,
    retryable: bool,
    error_code: str,
    error_message: str,
    retry_after_seconds: float | None = None,
    outcome_uncertain: bool = False,
    attempt_started_at: datetime,
    final_status: EmailOutboxStatus | None = None,
) -> None:
    now = datetime.now(UTC)
    async with AsyncSessionLocal() as db:
        outbox = await _get_claimed_email(db, claim, lock=True)
        if outbox is None:
            return
        first_attempt_at = outbox.first_provider_attempt_at
        idempotency_cutoff = (
            _as_utc(first_attempt_at) + BREVO_IDEMPOTENCY_WINDOW - MANUAL_RETRY_SAFETY_MARGIN
            if first_attempt_at is not None
            else None
        )
        inside_idempotency_window = idempotency_cutoff is None or now < idempotency_cutoff
        should_retry = final_status is None and (
            retryable and outbox.attempt_count < outbox.max_attempts and inside_idempotency_window
        )
        if should_retry:
            delay_seconds = max(
                _retry_delay_seconds(outbox.attempt_count),
                retry_after_seconds or 0.0,
            )
            outbox.status = EmailOutboxStatus.RETRY_SCHEDULED.value
            outbox.next_attempt_at = now + timedelta(seconds=delay_seconds)
            if (
                idempotency_cutoff is not None and outbox.next_attempt_at >= idempotency_cutoff
            ) or (
                outbox.valid_until is not None
                and outbox.next_attempt_at >= _as_utc(outbox.valid_until)
            ):
                should_retry = False
                outbox.status = EmailOutboxStatus.TERMINAL_FAILED.value
        else:
            outbox.status = (final_status or EmailOutboxStatus.TERMINAL_FAILED).value
        outbox.last_error_code = error_code[:80]
        outbox.last_error_message = error_message[:1000]
        outbox.outcome_uncertain = outcome_uncertain
        _release_lease(outbox)
        db.add(
            _attempt_record(
                outbox,
                status=outbox.status,
                started_at=attempt_started_at,
                error_code=error_code,
                error_message=error_message,
                outcome_uncertain=outcome_uncertain,
            )
        )
        if not settings.is_production:
            record_dev_delivery(
                account_id=outbox.account_id,
                recipient=outbox.recipient,
                subject="Email delivery attempt",
                body=REDACTED_EMAIL_BODY,
                status="failed",
                created_at=now,
            )
        await db.commit()
        if outbox.status in {
            EmailOutboxStatus.TERMINAL_FAILED.value,
            EmailOutboxStatus.RECONCILIATION_REQUIRED.value,
        }:
            await _notify_it_email_problem(db, outbox)
    logger.warning(
        "Email outbox attempt failed outbox_id=%s code=%s retryable=%s",
        claim.id,
        error_code,
        should_retry,
    )


async def _notify_it_email_problem(db: AsyncSession, outbox: EmailOutbox) -> None:
    try:
        purpose = outbox.purpose.replace("_", " ")
        await create_role_notifications(
            db,
            recipient_roles=[AccountRole.IT],
            title=f"Email to {outbox.recipient} needs attention.",
            message=(
                f"The {purpose} email could not be delivered. "
                f"{outbox.last_error_message or 'Open Email Problems to review the delivery.'}"
            ),
            notification_type="Email Problem",
            severity=(
                "Critical"
                if outbox.status == EmailOutboxStatus.RECONCILIATION_REQUIRED.value
                else "Warning"
            ),
            source_type="email.delivery",
            source_id=outbox.id,
            replace_existing_for_source=True,
        )
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("Failed to notify IT about email delivery outbox_id=%s", outbox.id)


async def _mark_email_problem_resolved(db: AsyncSession, outbox_id: str) -> None:
    try:
        await mark_source_notifications_read(db, source_type="email.delivery", source_id=outbox_id)
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("Failed to close IT email notification outbox_id=%s", outbox_id)


async def _get_claimed_email(
    db: AsyncSession, claim: ClaimedEmail, *, lock: bool = False
) -> EmailOutbox | None:
    statement = select(EmailOutbox).where(
        EmailOutbox.id == claim.id,
        EmailOutbox.status == EmailOutboxStatus.PROCESSING.value,
        EmailOutbox.lock_token == claim.lock_token,
    )
    if lock:
        statement = statement.with_for_update()
    return cast(EmailOutbox | None, await db.scalar(statement))


def _validate_brevo_configuration(settings: Settings) -> None:
    if settings.brevo_api_key is None:
        raise EmailRuntimeError("BREVO_API_KEY is not configured.")


def _load_tags(value: str | None) -> dict[str, str] | None:
    if value is None:
        return None
    try:
        tags = json.loads(value)
    except json.JSONDecodeError:
        return None
    if not isinstance(tags, dict) or any(
        not isinstance(key, str) or not isinstance(item, str) for key, item in tags.items()
    ):
        return None
    return tags


def _release_lease(outbox: EmailOutbox) -> None:
    outbox.lock_token = None
    outbox.locked_at = None
    outbox.lock_expires_at = None


def _retry_delay_seconds(attempt_count: int) -> float:
    schedule = (30.0, 120.0, 300.0, 600.0)
    return schedule[min(max(attempt_count - 1, 0), len(schedule) - 1)]


async def _prepare_provider_attempt(
    settings: Settings,
    claim: ClaimedEmail,
    *,
    provider_payload_hash: str,
) -> datetime:
    now = datetime.now(UTC)
    async with AsyncSessionLocal() as db:
        outbox = await _get_claimed_email(db, claim, lock=True)
        if outbox is None:
            raise EmailDispatchRejected(
                "The email delivery lease is no longer valid.",
                error_code="lease_lost",
            )
        if outbox.valid_until is not None and (
            now + timedelta(seconds=settings.email_request_timeout_seconds)
            >= _as_utc(outbox.valid_until)
        ):
            raise EmailDispatchRejected(
                "The email request expired before provider delivery.",
                error_code="request_expired",
                status=EmailOutboxStatus.EXPIRED,
            )
        if (
            outbox.provider_payload_hash is not None
            and outbox.provider_payload_hash != provider_payload_hash
        ):
            raise EmailDispatchRejected(
                "The immutable provider payload changed between attempts; a new message is required.",
                error_code="payload_conflict",
            )
        if outbox.first_provider_attempt_at is not None and now >= (
            _as_utc(outbox.first_provider_attempt_at)
            + BREVO_IDEMPOTENCY_WINDOW
            - MANUAL_RETRY_SAFETY_MARGIN
        ):
            raise EmailDispatchRejected(
                "The Brevo idempotency window elapsed; provider reconciliation is required.",
                error_code="idempotency_window_elapsed",
                status=(
                    EmailOutboxStatus.RECONCILIATION_REQUIRED
                    if outbox.outcome_uncertain
                    else EmailOutboxStatus.TERMINAL_FAILED
                ),
                outcome_uncertain=outbox.outcome_uncertain,
            )
        outbox.provider_payload_hash = provider_payload_hash
        if outbox.first_provider_attempt_at is None:
            outbox.first_provider_attempt_at = now
        outbox.last_provider_attempt_at = now
        outbox.outcome_uncertain = True
        await db.commit()
    return now


def _provider_payload_hash(
    *,
    sender: str,
    recipient: str,
    content: EmailContent,
    tags: dict[str, str] | None,
) -> str:
    payload = json.dumps(
        {
            "from": sender,
            "to": [recipient],
            "subject": content.subject,
            "text": content.text,
            "html": content.html,
            "tags": tags or {},
        },
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def _attempt_record(
    outbox: EmailOutbox,
    *,
    status: str,
    started_at: datetime,
    provider_message_id: str | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
    outcome_uncertain: bool = False,
) -> EmailDeliveryAttempt:
    return EmailDeliveryAttempt(
        id=str(uuid4()),
        outbox_id=outbox.id,
        attempt_number=outbox.attempt_count,
        provider=outbox.provider,
        status=status,
        provider_message_id=provider_message_id,
        error_code=error_code[:80] if error_code else None,
        error_message=error_message[:1000] if error_message else None,
        outcome_uncertain=outcome_uncertain,
        started_at=started_at,
        finished_at=datetime.now(UTC),
    )


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
