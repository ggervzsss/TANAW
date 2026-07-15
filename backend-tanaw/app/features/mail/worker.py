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
from app.features.mail.client import ResendAPIError
from app.features.mail.models import EmailDeliveryAttempt, EmailOutbox, EmailOutboxStatus
from app.features.mail.rendering import EmailRenderCancelled, render_outbox_email
from app.features.mail.runtime import EmailRuntimeError, get_resend_client
from app.features.mail.service import (
    MANUAL_RETRY_SAFETY_MARGIN,
    RESEND_IDEMPOTENCY_WINDOW,
)
from app.features.mail.templates import EmailContent

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
            sender = outbox.sender
            delivery_provider = outbox.provider

        if delivery_provider == "local":
            await _record_success(
                claim,
                provider="local",
                provider_message_id=None,
                outbox_status=EmailOutboxStatus.RECORDED,
                attempt_started_at=attempt_started_at,
            )
            return

        _validate_resend_recipient(settings, recipient)
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
        sent = await get_resend_client().send_email(
            sender=sender,
            recipient=recipient,
            subject=content.subject,
            text=content.text,
            html=content.html,
            idempotency_key=idempotency_key,
            tags=tags,
        )
        await _record_success(
            claim,
            provider="resend",
            provider_message_id=sent.id,
            outbox_status=EmailOutboxStatus.ACCEPTED,
            attempt_started_at=attempt_started_at,
        )
    except EmailRenderCancelled as exc:
        await _record_cancelled(claim, str(exc))
    except ResendAPIError as exc:
        await _record_failure(
            settings,
            claim,
            retryable=exc.retryable,
            error_code=exc.error_type
            or (f"http_{exc.status_code}" if exc.status_code is not None else "network_error"),
            error_message=str(exc),
            retry_after_seconds=exc.retry_after_seconds,
            outcome_uncertain=exc.status_code is None,
            attempt_started_at=attempt_started_at,
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
    claim: ClaimedEmail,
    *,
    provider: str,
    provider_message_id: str | None,
    outbox_status: EmailOutboxStatus,
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
        await db.commit()
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
        inside_idempotency_window = first_attempt_at is None or now < (
            _as_utc(first_attempt_at) + RESEND_IDEMPOTENCY_WINDOW - MANUAL_RETRY_SAFETY_MARGIN
        )
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
            if outbox.valid_until is not None and outbox.next_attempt_at >= _as_utc(
                outbox.valid_until
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
        await db.commit()
    logger.warning(
        "Email outbox attempt failed outbox_id=%s code=%s retryable=%s",
        claim.id,
        error_code,
        should_retry,
    )


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


def _validate_resend_recipient(settings: Settings, recipient: str) -> None:
    if settings.resend_api_key is None:
        raise EmailRuntimeError("RESEND_API_KEY is not configured.")
    if settings.email_test_recipient and recipient != str(settings.email_test_recipient).lower():
        raise EmailRuntimeError(
            "The Resend development sender can only deliver to EMAIL_TEST_RECIPIENT "
            "until a custom domain is verified."
        )


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
    schedule = (30.0, 120.0, 600.0, 1800.0, 3600.0)
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
            + RESEND_IDEMPOTENCY_WINDOW
            - MANUAL_RETRY_SAFETY_MARGIN
        ):
            raise EmailDispatchRejected(
                "The Resend idempotency window elapsed; provider reconciliation is required.",
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
