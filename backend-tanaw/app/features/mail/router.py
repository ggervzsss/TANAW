from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import create_activity_log
from app.features.mail.models import EmailOutbox, EmailOutboxStatus
from app.features.mail.schemas import EmailDeliverySummary
from app.features.mail.service import (
    MANUAL_RETRY_SAFETY_MARGIN,
    RESEND_IDEMPOTENCY_WINDOW,
    EmailOutboxRetryError,
    get_email_outbox,
    list_email_outbox,
    retry_terminal_email,
)

router = APIRouter(prefix="/mail", tags=["mail"])
ITAccount = Annotated[Account, Depends(require_roles({"it"}))]


@router.get("/deliveries", response_model=list[EmailDeliverySummary])
async def list_email_deliveries(
    _: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=500)] = 250,
) -> list[EmailDeliverySummary]:
    records = await list_email_outbox(db, limit=limit)
    return [to_email_delivery_summary(record) for record in records]


@router.get("/deliveries/{delivery_id}", response_model=EmailDeliverySummary)
async def get_email_delivery(
    delivery_id: str,
    _: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EmailDeliverySummary:
    record = await get_email_outbox(db, delivery_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery not found.")
    return to_email_delivery_summary(record)


@router.post(
    "/deliveries/{delivery_id}/retry",
    response_model=EmailDeliverySummary,
    status_code=status.HTTP_202_ACCEPTED,
)
async def retry_email_delivery(
    delivery_id: str,
    actor: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EmailDeliverySummary:
    try:
        record = await retry_terminal_email(db, delivery_id)
    except EmailOutboxRetryError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    await create_activity_log(
        db,
        ActivityLogCreate(
            category="IT Activity",
            severity="Info",
            actor=actor.display_name,
            actorRole="IT Personnel",
            action="Retry Email Delivery",
            target=record.recipient,
            summary=f"{actor.display_name} queued a retry for {record.purpose} email delivery.",
            sourceId=record.id,
            metadata={"purpose": record.purpose, "manualRetryCount": record.manual_retry_count},
        ),
        actor_account_id=actor.id,
    )
    await db.commit()
    return to_email_delivery_summary(record)


def to_email_delivery_summary(record: EmailOutbox) -> EmailDeliverySummary:
    return EmailDeliverySummary(
        id=record.id,
        purpose=record.purpose,
        recipient=record.recipient,
        provider=record.provider,
        status=record.status,
        attemptCount=record.attempt_count,
        maxAttempts=record.max_attempts,
        manualRetryCount=record.manual_retry_count,
        nextAttemptAt=(
            record.next_attempt_at
            if record.status == EmailOutboxStatus.RETRY_SCHEDULED.value
            else None
        ),
        providerMessageId=record.provider_message_id,
        errorCode=record.last_error_code,
        failureReason=record.last_error_message,
        outcomeUncertain=record.outcome_uncertain,
        canRetry=_can_retry(record),
        createdAt=record.created_at,
        acceptedAt=record.accepted_at,
    )


def _can_retry(record: EmailOutbox) -> bool:
    if record.status != EmailOutboxStatus.TERMINAL_FAILED.value:
        return False
    now = datetime.now(UTC)
    if record.valid_until is not None and _as_utc(record.valid_until) <= now:
        return False
    return record.first_provider_attempt_at is None or now < (
        _as_utc(record.first_provider_attempt_at)
        + RESEND_IDEMPOTENCY_WINDOW
        - MANUAL_RETRY_SAFETY_MARGIN
    )


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
