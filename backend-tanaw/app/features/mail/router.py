from collections.abc import Iterable
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account, AccountRole
from app.features.activity_logs.schemas import ActivityLogCreate
from app.features.activity_logs.service import (
    create_activity_log,
    get_actor_role_label_for_role,
)
from app.features.mail.models import EmailOutbox, EmailOutboxStatus
from app.features.mail.schemas import EmailDeliverySummary
from app.features.mail.service import (
    BREVO_IDEMPOTENCY_WINDOW,
    MANUAL_RETRY_SAFETY_MARGIN,
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
    since_days: Annotated[int | None, Query(alias="sinceDays", ge=1, le=365)] = None,
) -> list[EmailDeliverySummary]:
    created_since = (
        datetime.now(UTC) - timedelta(days=since_days) if since_days is not None else None
    )
    records = await list_email_outbox(db, limit=limit, created_since=created_since)
    recipients = await load_delivery_recipients(db, (record.account_id for record in records))
    return [
        to_email_delivery_summary(record, recipients.get(record.account_id)) for record in records
    ]


@router.get("/deliveries/{delivery_id}", response_model=EmailDeliverySummary)
async def get_email_delivery(
    delivery_id: str,
    _: ITAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> EmailDeliverySummary:
    record = await get_email_outbox(db, delivery_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Delivery not found.")
    recipients = await load_delivery_recipients(db, [record.account_id])
    return to_email_delivery_summary(record, recipients.get(record.account_id))


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
            group="Settings & Maintenance",
            severity="Info",
            actor=actor.display_name,
            actorRole="IT Personnel",
            action="Retry Email Delivery",
            target=record.recipient,
            summary=f"{actor.display_name} queued a retry for {record.purpose} email delivery.",
            sourceId=record.id,
            metadata={"purpose": record.purpose, "manualRetryCount": record.manual_retry_count},
        ),
    )
    recipients = await load_delivery_recipients(db, [record.account_id])
    return to_email_delivery_summary(record, recipients.get(record.account_id))


async def load_delivery_recipients(
    db: AsyncSession, account_ids: Iterable[str | None]
) -> dict[str, Account]:
    ids = sorted({account_id for account_id in account_ids if account_id})
    if not ids:
        return {}
    accounts = await db.scalars(select(Account).where(Account.id.in_(ids)))
    return {account.id: account for account in accounts}


def delivery_recipient_name(account: Account | None) -> str | None:
    if account is None:
        return None
    profile = account.enterprise_profile
    if account.role == AccountRole.ENTERPRISE and profile is not None:
        return profile.enterprise_name
    return account.display_name


def to_email_delivery_summary(
    record: EmailOutbox, account: Account | None = None
) -> EmailDeliverySummary:
    return EmailDeliverySummary(
        id=record.id,
        purpose=record.purpose,
        recipient=record.recipient,
        accountId=record.account_id,
        recipientName=delivery_recipient_name(account),
        recipientRole=get_actor_role_label_for_role(account.role) if account else None,
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
    if record.provider != "brevo":
        return False
    now = datetime.now(UTC)
    if record.valid_until is not None and _as_utc(record.valid_until) <= now:
        return False
    return record.first_provider_attempt_at is None or now < (
        _as_utc(record.first_provider_attempt_at)
        + BREVO_IDEMPOTENCY_WINDOW
        - MANUAL_RETRY_SAFETY_MARGIN
    )


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
