import hashlib
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import Settings
from app.core.security import hash_password
from app.features.accounts.models import (
    Account,
    AccountEmailChangeRequest,
    AccountEmailChangeStatus,
    AccountRole,
    AccountStatus,
)
from app.features.auth.models import (
    AccountActivationToken,
    PasswordResetChallenge,
    PasswordResetRateLimitBucket,
)
from app.features.mail.models import (
    EmailDeliveryAttempt,
    EmailOutbox,
    EmailOutboxStatus,
    EmailTemplateName,
)
from app.features.maintenance.retention import run_retention_cleanup

TEST_DATABASE_ENV = "TANAW_TEST_DATABASE_URL"
TEST_PREFIX = "tanaw-retention-pg-"
TEST_EMAIL_PATTERN = f"{TEST_PREFIX}%@example.com"
TEST_RATE_PATTERN = f"{TEST_PREFIX}%"


@dataclass(frozen=True)
class PostgresRuntime:
    engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    settings: Settings


def _postgres_async_url(raw_url: str) -> str:
    normalized = raw_url.strip()
    if normalized.startswith("postgres://"):
        normalized = f"postgresql://{normalized.removeprefix('postgres://')}"
    if normalized.startswith("postgresql://"):
        normalized = normalized.replace("postgresql://", "postgresql+asyncpg://", 1)
    if not normalized.startswith("postgresql+asyncpg://"):
        raise pytest.UsageError(f"{TEST_DATABASE_ENV} must point to PostgreSQL via asyncpg.")
    return normalized


@pytest_asyncio.fixture
async def postgres_runtime() -> AsyncIterator[PostgresRuntime]:
    raw_url = os.getenv(TEST_DATABASE_ENV)
    if not raw_url:
        pytest.skip(f"{TEST_DATABASE_ENV} is not configured.")

    database_url = _postgres_async_url(raw_url)
    engine = create_async_engine(database_url, pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    settings = Settings(
        environment="development",
        database_url=database_url,
        retention_cleanup_batch_size=10,
        activation_token_retention_days=30,
        password_reset_retention_days=30,
        password_reset_rate_bucket_retention_days=2,
        account_email_change_retention_days=180,
        email_outbox_retention_days=180,
        failed_email_outbox_retention_days=365,
    )
    runtime = PostgresRuntime(engine=engine, sessions=sessions, settings=settings)
    await _clean_rows(runtime)
    try:
        yield runtime
    finally:
        await _clean_rows(runtime)
        await engine.dispose()


async def _clean_rows(runtime: PostgresRuntime) -> None:
    async with runtime.sessions() as db:
        account_ids = list(
            await db.scalars(select(Account.id).where(Account.email.like(TEST_EMAIL_PATTERN)))
        )
        outbox_ids = list(
            await db.scalars(
                select(EmailOutbox.id).where(
                    or_(
                        EmailOutbox.purpose.like(f"{TEST_PREFIX}%"),
                        EmailOutbox.recipient.like(TEST_EMAIL_PATTERN),
                        EmailOutbox.source_id.like(f"{TEST_PREFIX}%"),
                    )
                )
            )
        )
        if outbox_ids:
            await db.execute(
                delete(EmailDeliveryAttempt).where(EmailDeliveryAttempt.outbox_id.in_(outbox_ids))
            )
            await db.execute(delete(EmailOutbox).where(EmailOutbox.id.in_(outbox_ids)))
        await db.execute(
            delete(PasswordResetRateLimitBucket).where(
                PasswordResetRateLimitBucket.bucket_key.like(TEST_RATE_PATTERN)
            )
        )
        await db.execute(
            delete(PasswordResetChallenge).where(
                PasswordResetChallenge.email.like(TEST_EMAIL_PATTERN)
            )
        )
        if account_ids:
            await db.execute(
                delete(AccountActivationToken).where(
                    AccountActivationToken.account_id.in_(account_ids)
                )
            )
            await db.execute(
                delete(AccountEmailChangeRequest).where(
                    AccountEmailChangeRequest.account_id.in_(account_ids)
                )
            )
            await db.execute(delete(Account).where(Account.id.in_(account_ids)))
        await db.commit()


def _digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _test_id(label: str) -> str:
    return f"{TEST_PREFIX}{label}-{uuid4().hex[:12]}"


def _outbox(
    *,
    account_id: str,
    label: str,
    status: EmailOutboxStatus,
    timestamp: datetime,
    source_id: str | None = None,
    template_name: EmailTemplateName = EmailTemplateName.SUPPORT_REPLY,
) -> EmailOutbox:
    source = source_id or f"{TEST_PREFIX}source-{label}"
    return EmailOutbox(
        id=str(uuid4()),
        account_id=account_id,
        purpose=f"{TEST_PREFIX}{label}"[:60],
        source_id=source,
        recipient=f"{TEST_PREFIX}{label}@example.com",
        sender="TANAW <no-reply@example.com>",
        template_name=template_name.value,
        template_version="v1",
        secret_version="v1",
        template_payload_json="{}",
        idempotency_key=f"{TEST_PREFIX}{label}-{uuid4().hex}",
        provider="local",
        status=status.value,
        attempt_count=0,
        max_attempts=5,
        next_attempt_at=timestamp,
        created_at=timestamp,
        updated_at=timestamp,
    )


@pytest.mark.asyncio
async def test_retention_cleanup_batches_expired_data_and_preserves_live_records(
    postgres_runtime: PostgresRuntime,
) -> None:
    now = datetime.now(UTC)
    very_old = now - timedelta(days=400)
    old = now - timedelta(days=200)
    old_security_record = now - timedelta(days=40)
    recent = now - timedelta(days=1)
    account_id = str(uuid4())
    account_email = f"{TEST_PREFIX}owner-{uuid4().hex}@example.com"
    expired_request_id = _test_id("expired-request")
    deleted_request_id = _test_id("deleted-request")
    recent_request_id = _test_id("recent-request")

    account = Account(
        id=account_id,
        email=account_email,
        password_hash=hash_password("Retention integration test passphrase 2026"),
        role=AccountRole.IT,
        display_name="Retention PostgreSQL Test",
        title="IT Personnel",
        status=AccountStatus.ACTIVE,
        activated_at=now,
        password_changed_at=now,
    )

    old_activation_ids = [_test_id(f"activation-old-{index}") for index in range(11)]
    recent_activation_id = _test_id("activation-recent")
    live_activation_id = _test_id("activation-live")
    old_challenge_id = _test_id("challenge-old")
    recent_challenge_id = _test_id("challenge-recent")
    live_challenge_id = _test_id("challenge-live")
    old_rate_key = f"{TEST_PREFIX}rate-old-{uuid4().hex}"
    recent_rate_key = f"{TEST_PREFIX}rate-recent-{uuid4().hex}"

    accepted_outbox = _outbox(
        account_id=account_id,
        label=f"accepted-{uuid4().hex}",
        status=EmailOutboxStatus.ACCEPTED,
        timestamp=old,
    )
    failed_within_audit_retention = _outbox(
        account_id=account_id,
        label=f"failed-recent-{uuid4().hex}",
        status=EmailOutboxStatus.TERMINAL_FAILED,
        timestamp=old,
    )
    failed_past_audit_retention = _outbox(
        account_id=account_id,
        label=f"failed-old-{uuid4().hex}",
        status=EmailOutboxStatus.TERMINAL_FAILED,
        timestamp=very_old,
    )
    live_queued_outbox = _outbox(
        account_id=account_id,
        label=f"queued-{uuid4().hex}",
        status=EmailOutboxStatus.QUEUED,
        timestamp=very_old,
    )
    verification_outbox = _outbox(
        account_id=account_id,
        label=f"verification-{uuid4().hex}",
        status=EmailOutboxStatus.QUEUED,
        timestamp=recent,
        source_id=expired_request_id,
        template_name=EmailTemplateName.ACCOUNT_EMAIL_CHANGE_VERIFICATION,
    )
    notice_outbox = _outbox(
        account_id=account_id,
        label=f"notice-{uuid4().hex}",
        status=EmailOutboxStatus.QUEUED,
        timestamp=recent,
        source_id=expired_request_id,
        template_name=EmailTemplateName.ACCOUNT_EMAIL_CHANGE_REQUEST_NOTICE,
    )
    accepted_attempt_id = str(uuid4())

    async with postgres_runtime.sessions() as db:
        db.add(account)
        db.add_all(
            [
                AccountActivationToken(
                    id=token_id,
                    account_id=account_id,
                    token_hash=_digest(token_id),
                    expires_at=old_security_record,
                    consumed_at=old_security_record,
                    created_at=old_security_record,
                )
                for token_id in old_activation_ids
            ]
        )
        db.add_all(
            [
                AccountActivationToken(
                    id=recent_activation_id,
                    account_id=account_id,
                    token_hash=_digest(recent_activation_id),
                    expires_at=recent,
                    created_at=recent,
                ),
                AccountActivationToken(
                    id=live_activation_id,
                    account_id=account_id,
                    token_hash=_digest(live_activation_id),
                    expires_at=now + timedelta(days=1),
                    created_at=now,
                ),
                PasswordResetChallenge(
                    id=old_challenge_id,
                    email=account_email,
                    account_id=account_id,
                    code_hash=_digest(old_challenge_id),
                    expires_at=old_security_record,
                    used=True,
                    used_at=old_security_record,
                    created_at=old_security_record,
                ),
                PasswordResetChallenge(
                    id=recent_challenge_id,
                    email=account_email,
                    account_id=account_id,
                    code_hash=_digest(recent_challenge_id),
                    expires_at=recent,
                    created_at=recent,
                ),
                PasswordResetChallenge(
                    id=live_challenge_id,
                    email=account_email,
                    account_id=account_id,
                    code_hash=_digest(live_challenge_id),
                    expires_at=now + timedelta(minutes=30),
                    created_at=now,
                ),
                PasswordResetRateLimitBucket(
                    bucket_key=old_rate_key,
                    scope="identifier",
                    window_started_at=old_security_record,
                    request_count=1,
                    updated_at=old_security_record,
                ),
                PasswordResetRateLimitBucket(
                    bucket_key=recent_rate_key,
                    scope="identifier",
                    window_started_at=recent,
                    request_count=1,
                    updated_at=recent,
                ),
                AccountEmailChangeRequest(
                    id=expired_request_id,
                    account_id=account_id,
                    old_email=account_email,
                    requested_email=f"{TEST_PREFIX}expired-new-{uuid4().hex}@example.com",
                    token_hash=_digest(expired_request_id),
                    status=AccountEmailChangeStatus.PENDING_VERIFICATION.value,
                    expires_at=now - timedelta(minutes=1),
                    requested_by_account_id=account_id,
                    requested_by_name="Retention PostgreSQL Test",
                    requested_by_role="IT Personnel",
                    created_at=recent,
                    updated_at=recent,
                ),
                AccountEmailChangeRequest(
                    id=deleted_request_id,
                    account_id=account_id,
                    old_email=account_email,
                    requested_email=f"{TEST_PREFIX}old-new-{uuid4().hex}@example.com",
                    token_hash=None,
                    status=AccountEmailChangeStatus.APPROVED.value,
                    expires_at=old,
                    requested_by_account_id=account_id,
                    requested_by_name="Retention PostgreSQL Test",
                    requested_by_role="IT Personnel",
                    resolved_at=old,
                    created_at=old,
                    updated_at=old,
                ),
                AccountEmailChangeRequest(
                    id=recent_request_id,
                    account_id=account_id,
                    old_email=account_email,
                    requested_email=f"{TEST_PREFIX}recent-new-{uuid4().hex}@example.com",
                    token_hash=None,
                    status=AccountEmailChangeStatus.REJECTED.value,
                    expires_at=recent,
                    requested_by_account_id=account_id,
                    requested_by_name="Retention PostgreSQL Test",
                    requested_by_role="IT Personnel",
                    resolved_at=recent,
                    created_at=recent,
                    updated_at=recent,
                ),
                accepted_outbox,
                failed_within_audit_retention,
                failed_past_audit_retention,
                live_queued_outbox,
                verification_outbox,
                notice_outbox,
            ]
        )
        await db.flush()
        db.add(
            EmailDeliveryAttempt(
                id=accepted_attempt_id,
                outbox_id=accepted_outbox.id,
                attempt_number=1,
                provider="local",
                status=EmailOutboxStatus.ACCEPTED.value,
                started_at=old,
                finished_at=old,
            )
        )
        await db.commit()

    first_counts = await run_retention_cleanup(
        postgres_runtime.settings,
        now=now,
        session_factory=postgres_runtime.sessions,
    )

    assert first_counts.activation_tokens == 10
    assert first_counts.password_reset_challenges == 1
    assert first_counts.password_reset_rate_buckets == 1
    assert first_counts.expired_email_change_requests == 1
    assert first_counts.email_change_requests == 1
    assert first_counts.email_outbox_records == 2

    async with postgres_runtime.sessions() as db:
        remaining_old_activation_ids = set(
            await db.scalars(
                select(AccountActivationToken.id).where(
                    AccountActivationToken.id.in_(old_activation_ids)
                )
            )
        )
        assert len(remaining_old_activation_ids) == 1

        expired_request = await db.get(AccountEmailChangeRequest, expired_request_id)
        assert expired_request is not None
        assert expired_request.status == AccountEmailChangeStatus.EXPIRED.value
        assert expired_request.token_hash is None
        assert expired_request.invalidated_at is not None
        assert expired_request.resolved_at is not None

        verification = await db.get(EmailOutbox, verification_outbox.id)
        notice = await db.get(EmailOutbox, notice_outbox.id)
        assert verification is not None
        assert notice is not None
        assert verification.status == EmailOutboxStatus.CANCELLED.value
        assert notice.status == EmailOutboxStatus.CANCELLED.value

    second_counts = await run_retention_cleanup(
        postgres_runtime.settings,
        now=now,
        session_factory=postgres_runtime.sessions,
    )
    assert second_counts.activation_tokens == 1

    async with postgres_runtime.sessions() as db:
        assert await db.get(AccountActivationToken, recent_activation_id) is not None
        assert await db.get(AccountActivationToken, live_activation_id) is not None
        assert await db.get(PasswordResetChallenge, old_challenge_id) is None
        assert await db.get(PasswordResetChallenge, recent_challenge_id) is not None
        assert await db.get(PasswordResetChallenge, live_challenge_id) is not None
        assert await db.get(PasswordResetRateLimitBucket, old_rate_key) is None
        assert await db.get(PasswordResetRateLimitBucket, recent_rate_key) is not None
        assert await db.get(AccountEmailChangeRequest, deleted_request_id) is None
        assert await db.get(AccountEmailChangeRequest, recent_request_id) is not None

        assert await db.get(EmailOutbox, accepted_outbox.id) is None
        assert await db.get(EmailOutbox, failed_past_audit_retention.id) is None
        assert await db.get(EmailDeliveryAttempt, accepted_attempt_id) is None
        assert await db.get(EmailOutbox, failed_within_audit_retention.id) is not None
        assert await db.get(EmailOutbox, live_queued_outbox.id) is not None
