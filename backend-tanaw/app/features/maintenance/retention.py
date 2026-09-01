from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.db.session import AsyncSessionLocal
from app.features.accounts.models import (
    AccountEmailChangeRequest,
    AccountEmailChangeStatus,
)
from app.features.auth.email_change import ACTIVE_EMAIL_CHANGE_STATUSES
from app.features.auth.models import (
    AccountActivationToken,
    PasswordResetChallenge,
    PasswordResetRateLimitBucket,
)
from app.features.mail.models import EmailOutbox, EmailOutboxStatus, EmailTemplateName
from app.features.mail.service import cancel_pending_source_emails
from app.features.monitoring.models import EnterpriseTelemetrySnapshot

SessionFactory = async_sessionmaker[AsyncSession]

STANDARD_TERMINAL_OUTBOX_STATUSES = (
    EmailOutboxStatus.ACCEPTED.value,
    EmailOutboxStatus.RECORDED.value,
    EmailOutboxStatus.CANCELLED.value,
    EmailOutboxStatus.EXPIRED.value,
)
FAILED_TERMINAL_OUTBOX_STATUSES = (
    EmailOutboxStatus.TERMINAL_FAILED.value,
    EmailOutboxStatus.RECONCILIATION_REQUIRED.value,
)


@dataclass(frozen=True)
class RetentionCleanupCounts:
    telemetry_snapshots: int = 0
    activation_tokens: int = 0
    password_reset_challenges: int = 0
    password_reset_rate_buckets: int = 0
    expired_email_change_requests: int = 0
    email_change_requests: int = 0
    email_outbox_records: int = 0

    @property
    def deleted_records(self) -> int:
        return (
            self.telemetry_snapshots
            + self.activation_tokens
            + self.password_reset_challenges
            + self.password_reset_rate_buckets
            + self.email_change_requests
            + self.email_outbox_records
        )


async def run_retention_cleanup(
    settings: Settings,
    *,
    now: datetime | None = None,
    session_factory: SessionFactory = AsyncSessionLocal,
) -> RetentionCleanupCounts:
    current = _as_utc(now or datetime.now(UTC))
    batch_size = settings.retention_cleanup_batch_size
    return RetentionCleanupCounts(
        telemetry_snapshots=await _delete_telemetry_snapshots(
            session_factory,
            cutoff=current - timedelta(days=settings.telemetry_raw_retention_days),
            batch_size=settings.telemetry_retention_batch_size,
        ),
        activation_tokens=await _delete_activation_tokens(
            session_factory,
            cutoff=current - timedelta(days=settings.activation_token_retention_days),
            current=current,
            batch_size=batch_size,
        ),
        password_reset_challenges=await _delete_password_reset_challenges(
            session_factory,
            cutoff=current - timedelta(days=settings.password_reset_retention_days),
            current=current,
            batch_size=batch_size,
        ),
        password_reset_rate_buckets=await _delete_password_reset_rate_buckets(
            session_factory,
            cutoff=current - timedelta(days=settings.password_reset_rate_bucket_retention_days),
            batch_size=batch_size,
        ),
        expired_email_change_requests=await _expire_email_change_requests(
            session_factory,
            current=current,
            batch_size=batch_size,
        ),
        email_change_requests=await _delete_email_change_requests(
            session_factory,
            cutoff=current - timedelta(days=settings.account_email_change_retention_days),
            batch_size=batch_size,
        ),
        email_outbox_records=await _delete_email_outbox_records(
            session_factory,
            standard_cutoff=current - timedelta(days=settings.email_outbox_retention_days),
            failed_cutoff=current - timedelta(days=settings.failed_email_outbox_retention_days),
            batch_size=batch_size,
        ),
    )


async def _delete_telemetry_snapshots(
    session_factory: SessionFactory,
    *,
    cutoff: datetime,
    batch_size: int,
) -> int:
    async with session_factory() as db:
        ids = list(
            await db.scalars(
                select(EnterpriseTelemetrySnapshot.id)
                .where(EnterpriseTelemetrySnapshot.received_at < cutoff)
                .order_by(
                    EnterpriseTelemetrySnapshot.received_at.asc(),
                    EnterpriseTelemetrySnapshot.id.asc(),
                )
                .with_for_update(skip_locked=True)
                .limit(batch_size)
            )
        )
        if ids:
            await db.execute(
                delete(EnterpriseTelemetrySnapshot).where(EnterpriseTelemetrySnapshot.id.in_(ids))
            )
        await db.commit()
        return len(ids)


async def _delete_activation_tokens(
    session_factory: SessionFactory,
    *,
    cutoff: datetime,
    current: datetime,
    batch_size: int,
) -> int:
    terminal_at = func.coalesce(
        AccountActivationToken.consumed_at,
        AccountActivationToken.invalidated_at,
        AccountActivationToken.expires_at,
    )
    async with session_factory() as db:
        ids = list(
            await db.scalars(
                select(AccountActivationToken.id)
                .where(
                    or_(
                        AccountActivationToken.consumed_at.is_not(None),
                        AccountActivationToken.invalidated_at.is_not(None),
                        AccountActivationToken.expires_at <= current,
                    ),
                    terminal_at < cutoff,
                )
                .order_by(terminal_at.asc(), AccountActivationToken.id.asc())
                .with_for_update(skip_locked=True)
                .limit(batch_size)
            )
        )
        if ids:
            await db.execute(
                delete(AccountActivationToken).where(AccountActivationToken.id.in_(ids))
            )
        await db.commit()
        return len(ids)


async def _delete_password_reset_challenges(
    session_factory: SessionFactory,
    *,
    cutoff: datetime,
    current: datetime,
    batch_size: int,
) -> int:
    terminal_at = func.coalesce(
        PasswordResetChallenge.used_at,
        PasswordResetChallenge.invalidated_at,
        PasswordResetChallenge.expires_at,
    )
    async with session_factory() as db:
        ids = list(
            await db.scalars(
                select(PasswordResetChallenge.id)
                .where(
                    or_(
                        PasswordResetChallenge.used.is_(True),
                        PasswordResetChallenge.invalidated_at.is_not(None),
                        PasswordResetChallenge.expires_at <= current,
                    ),
                    terminal_at < cutoff,
                )
                .order_by(terminal_at.asc(), PasswordResetChallenge.id.asc())
                .with_for_update(skip_locked=True)
                .limit(batch_size)
            )
        )
        if ids:
            await db.execute(
                delete(PasswordResetChallenge).where(PasswordResetChallenge.id.in_(ids))
            )
        await db.commit()
        return len(ids)


async def _delete_password_reset_rate_buckets(
    session_factory: SessionFactory,
    *,
    cutoff: datetime,
    batch_size: int,
) -> int:
    async with session_factory() as db:
        keys = list(
            await db.scalars(
                select(PasswordResetRateLimitBucket.bucket_key)
                .where(PasswordResetRateLimitBucket.updated_at < cutoff)
                .order_by(
                    PasswordResetRateLimitBucket.updated_at.asc(),
                    PasswordResetRateLimitBucket.bucket_key.asc(),
                )
                .with_for_update(skip_locked=True)
                .limit(batch_size)
            )
        )
        if keys:
            await db.execute(
                delete(PasswordResetRateLimitBucket).where(
                    PasswordResetRateLimitBucket.bucket_key.in_(keys)
                )
            )
        await db.commit()
        return len(keys)


async def _expire_email_change_requests(
    session_factory: SessionFactory,
    *,
    current: datetime,
    batch_size: int,
) -> int:
    async with session_factory() as db:
        requests = list(
            await db.scalars(
                select(AccountEmailChangeRequest)
                .where(
                    AccountEmailChangeRequest.status.in_(ACTIVE_EMAIL_CHANGE_STATUSES),
                    AccountEmailChangeRequest.expires_at <= current,
                )
                .order_by(
                    AccountEmailChangeRequest.expires_at.asc(),
                    AccountEmailChangeRequest.id.asc(),
                )
                .with_for_update(skip_locked=True)
                .limit(batch_size)
            )
        )
        source_ids: list[str] = []
        for request in requests:
            request.status = AccountEmailChangeStatus.EXPIRED.value
            request.token_hash = None
            request.invalidated_at = current
            request.resolved_at = current
            source_ids.append(request.id)
        if source_ids:
            for template_name in (
                EmailTemplateName.ACCOUNT_EMAIL_CHANGE_VERIFICATION,
                EmailTemplateName.ACCOUNT_EMAIL_CHANGE_REQUEST_NOTICE,
            ):
                await cancel_pending_source_emails(
                    db,
                    template_name=template_name,
                    source_ids=source_ids,
                    reason="The email ownership request expired during retention maintenance.",
                )
        await db.commit()
        return len(requests)


async def _delete_email_change_requests(
    session_factory: SessionFactory,
    *,
    cutoff: datetime,
    batch_size: int,
) -> int:
    terminal_at = func.coalesce(
        AccountEmailChangeRequest.resolved_at,
        AccountEmailChangeRequest.invalidated_at,
        AccountEmailChangeRequest.expires_at,
        AccountEmailChangeRequest.created_at,
    )
    async with session_factory() as db:
        ids = list(
            await db.scalars(
                select(AccountEmailChangeRequest.id)
                .where(
                    AccountEmailChangeRequest.status.not_in(ACTIVE_EMAIL_CHANGE_STATUSES),
                    terminal_at < cutoff,
                )
                .order_by(terminal_at.asc(), AccountEmailChangeRequest.id.asc())
                .with_for_update(skip_locked=True)
                .limit(batch_size)
            )
        )
        if ids:
            await db.execute(
                delete(AccountEmailChangeRequest).where(AccountEmailChangeRequest.id.in_(ids))
            )
        await db.commit()
        return len(ids)


async def _delete_email_outbox_records(
    session_factory: SessionFactory,
    *,
    standard_cutoff: datetime,
    failed_cutoff: datetime,
    batch_size: int,
) -> int:
    async with session_factory() as db:
        ids = list(
            await db.scalars(
                select(EmailOutbox.id)
                .where(
                    or_(
                        (
                            EmailOutbox.status.in_(STANDARD_TERMINAL_OUTBOX_STATUSES)
                            & (EmailOutbox.updated_at < standard_cutoff)
                        ),
                        (
                            EmailOutbox.status.in_(FAILED_TERMINAL_OUTBOX_STATUSES)
                            & (EmailOutbox.updated_at < failed_cutoff)
                        ),
                    )
                )
                .order_by(EmailOutbox.updated_at.asc(), EmailOutbox.id.asc())
                .with_for_update(skip_locked=True)
                .limit(batch_size)
            )
        )
        if ids:
            await db.execute(delete(EmailOutbox).where(EmailOutbox.id.in_(ids)))
        await db.commit()
        return len(ids)


def _as_utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
