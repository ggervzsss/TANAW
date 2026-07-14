import asyncio
import json
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from pydantic import SecretStr
from sqlalchemy import delete, event, func, or_, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    DeliveryStatus,
    DevDelivery,
)
from app.features.auth import account_activation, password_recovery, secret_values
from app.features.auth.models import AccountActivationToken, PasswordResetChallenge
from app.features.mail import service as mail_service
from app.features.mail import worker as mail_worker
from app.features.mail.client import ResendAPIError, SentEmail
from app.features.mail.models import (
    EmailDeliveryAttempt,
    EmailOutbox,
    EmailOutboxStatus,
    EmailTemplateName,
)
from app.features.mail.service import (
    MANUAL_RETRY_SAFETY_MARGIN,
    REDACTED_EMAIL_BODY,
    RESEND_IDEMPOTENCY_WINDOW,
    enqueue_email,
)

TEST_DATABASE_ENV = "TANAW_TEST_DATABASE_URL"
TEST_EMAIL_PATTERN = "tanaw-pg-%@example.com"
TEST_SOURCE_PREFIX = "tanaw-pg-"


@dataclass(frozen=True)
class PostgresRuntime:
    engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    settings: Settings


@dataclass(frozen=True)
class CreatedAccount:
    id: str
    email: str


class AcceptingResendClient:
    def __init__(self) -> None:
        self.idempotency_keys: list[str] = []

    async def send_email(
        self,
        *,
        sender: str,
        recipient: str,
        subject: str,
        text: str,
        html: str,
        idempotency_key: str,
        tags: dict[str, str] | None = None,
    ) -> SentEmail:
        del sender, recipient, subject, text, html, tags
        self.idempotency_keys.append(idempotency_key)
        return SentEmail(id=f"postgres-test-{uuid4()}")


class TimeoutThenAcceptResendClient(AcceptingResendClient):
    async def send_email(
        self,
        *,
        sender: str,
        recipient: str,
        subject: str,
        text: str,
        html: str,
        idempotency_key: str,
        tags: dict[str, str] | None = None,
    ) -> SentEmail:
        self.idempotency_keys.append(idempotency_key)
        if len(self.idempotency_keys) == 1:
            raise ResendAPIError("Resend timed out before TANAW received a response.")
        del sender, recipient, subject, text, html, tags
        return SentEmail(id=f"postgres-test-{uuid4()}")


class IdempotentAcceptingResendClient(AcceptingResendClient):
    def __init__(self) -> None:
        super().__init__()
        self.provider_ids: dict[str, str] = {}

    async def send_email(
        self,
        *,
        sender: str,
        recipient: str,
        subject: str,
        text: str,
        html: str,
        idempotency_key: str,
        tags: dict[str, str] | None = None,
    ) -> SentEmail:
        del sender, recipient, subject, text, html, tags
        self.idempotency_keys.append(idempotency_key)
        provider_id = self.provider_ids.setdefault(idempotency_key, f"postgres-test-{uuid4()}")
        return SentEmail(id=provider_id)


class PermanentlyRejectingResendClient(AcceptingResendClient):
    async def send_email(
        self,
        *,
        sender: str,
        recipient: str,
        subject: str,
        text: str,
        html: str,
        idempotency_key: str,
        tags: dict[str, str] | None = None,
    ) -> SentEmail:
        del sender, recipient, subject, text, html, tags
        self.idempotency_keys.append(idempotency_key)
        raise ResendAPIError(
            "Resend rejected the recipient.",
            status_code=422,
            error_type="validation_error",
        )


class BlockingResendClient(AcceptingResendClient):
    def __init__(self) -> None:
        super().__init__()
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def send_email(
        self,
        *,
        sender: str,
        recipient: str,
        subject: str,
        text: str,
        html: str,
        idempotency_key: str,
        tags: dict[str, str] | None = None,
    ) -> SentEmail:
        del sender, recipient, subject, text, html, tags
        self.idempotency_keys.append(idempotency_key)
        self.started.set()
        await self.release.wait()
        return SentEmail(id=f"postgres-test-{uuid4()}")


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
async def postgres_runtime(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[PostgresRuntime]:
    raw_url = os.getenv(TEST_DATABASE_ENV)
    if not raw_url:
        pytest.skip(f"{TEST_DATABASE_ENV} is not configured.")

    database_url = _postgres_async_url(raw_url)
    engine = create_async_engine(database_url, pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    settings = Settings(
        environment="development",
        database_url=database_url,
        email_delivery_mode="resend",
        resend_api_key=SecretStr("re_postgres_outbox_test_key_123456789"),
        email_from_name="TANAW PostgreSQL Test",
        email_from_address="no-reply@example.com",
        email_secret_derivation_key=SecretStr("postgres-outbox-test-derivation-key-123456789"),
        email_outbox_batch_size=5,
        email_outbox_max_attempts=5,
    )

    await _clean_postgres_rows(sessions)
    monkeypatch.setattr(mail_worker, "AsyncSessionLocal", sessions)
    monkeypatch.setattr(mail_service, "get_settings", lambda: settings)
    monkeypatch.setattr(account_activation, "get_settings", lambda: settings)
    monkeypatch.setattr(password_recovery, "get_settings", lambda: settings)
    monkeypatch.setattr(secret_values, "get_settings", lambda: settings)

    runtime = PostgresRuntime(engine=engine, sessions=sessions, settings=settings)
    try:
        yield runtime
    finally:
        await _clean_postgres_rows(sessions)
        await engine.dispose()


async def _clean_postgres_rows(sessions: async_sessionmaker[AsyncSession]) -> None:
    async with sessions() as db:
        account_ids = list(
            await db.scalars(select(Account.id).where(Account.email.like(TEST_EMAIL_PATTERN)))
        )
        outbox_ids = list(
            await db.scalars(
                select(EmailOutbox.id).where(
                    or_(
                        EmailOutbox.recipient.like(TEST_EMAIL_PATTERN),
                        EmailOutbox.source_id.like(f"{TEST_SOURCE_PREFIX}%"),
                    )
                )
            )
        )
        if outbox_ids:
            await db.execute(
                delete(EmailDeliveryAttempt).where(EmailDeliveryAttempt.outbox_id.in_(outbox_ids))
            )
            await db.execute(delete(EmailOutbox).where(EmailOutbox.id.in_(outbox_ids)))
        if account_ids:
            await db.execute(
                delete(AccountActivationToken).where(
                    AccountActivationToken.account_id.in_(account_ids)
                )
            )
            await db.execute(
                delete(PasswordResetChallenge).where(
                    or_(
                        PasswordResetChallenge.email.like(TEST_EMAIL_PATTERN),
                        PasswordResetChallenge.account_id.in_(account_ids),
                    )
                )
            )
        else:
            await db.execute(
                delete(PasswordResetChallenge).where(
                    PasswordResetChallenge.email.like(TEST_EMAIL_PATTERN)
                )
            )
        if account_ids:
            await db.execute(
                delete(DevDelivery).where(
                    or_(
                        DevDelivery.recipient.like(TEST_EMAIL_PATTERN),
                        DevDelivery.account_id.in_(account_ids),
                    )
                )
            )
        else:
            await db.execute(
                delete(DevDelivery).where(DevDelivery.recipient.like(TEST_EMAIL_PATTERN))
            )
        if account_ids:
            await db.execute(delete(Account).where(Account.id.in_(account_ids)))
        await db.commit()


async def _create_account(
    runtime: PostgresRuntime,
    *,
    label: str,
    activated: bool = True,
) -> CreatedAccount:
    account_id = str(uuid4())
    email = f"tanaw-pg-{label}-{uuid4().hex}@example.com"
    now = datetime.now(UTC)
    account = Account(
        id=account_id,
        email=email,
        phone=None,
        password_hash="not-a-login-password",
        role=AccountRole.STAFF,
        display_name=f"PostgreSQL Test {label}",
        title="PostgreSQL integration test",
        status=AccountStatus.ACTIVE,
        is_protected_system_account=False,
        activated_at=now if activated else None,
        password_changed_at=now if activated else None,
    )
    async with runtime.sessions() as db:
        db.add(account)
        await db.commit()
    return CreatedAccount(id=account_id, email=email)


async def _enqueue_business_email(
    runtime: PostgresRuntime,
    account: CreatedAccount,
    *,
    label: str,
) -> tuple[str, str]:
    source_id = f"{TEST_SOURCE_PREFIX}{label}-{uuid4()}"
    idempotency_key = f"tanaw-postgres-test-{uuid4()}"
    async with runtime.sessions() as db:
        stored_account = await db.get(Account, account.id)
        assert stored_account is not None
        outbox = await enqueue_email(
            db,
            account_id=stored_account.id,
            source_id=source_id,
            recipient=stored_account.email,
            template_name=EmailTemplateName.BUSINESS_EMAIL_CHANGE,
            template_payload={
                "displayName": stored_account.display_name,
                "email": stored_account.email,
                "role": stored_account.role.value,
                "enterpriseId": "",
                "newEmail": stored_account.email,
            },
            idempotency_key=idempotency_key,
            tags={"category": f"{TEST_SOURCE_PREFIX}business-email"},
            valid_until=datetime.now(UTC) + timedelta(days=1),
        )
        outbox_id = outbox.id
        await db.commit()
    return outbox_id, idempotency_key


async def _get_outbox(runtime: PostgresRuntime, outbox_id: str) -> EmailOutbox:
    async with runtime.sessions() as db:
        outbox = await db.get(EmailOutbox, outbox_id)
        assert outbox is not None
        return outbox


async def _make_retry_due(
    runtime: PostgresRuntime,
    outbox_id: str,
    *,
    first_provider_attempt_at: datetime | None = None,
) -> None:
    async with runtime.sessions() as db:
        outbox = await db.get(EmailOutbox, outbox_id)
        assert outbox is not None
        outbox.next_attempt_at = datetime.now(UTC) - timedelta(seconds=1)
        if first_provider_attempt_at is not None:
            outbox.first_provider_attempt_at = first_provider_attempt_at
        await db.commit()


@pytest.mark.asyncio
async def test_transaction_rollback_leaves_no_activation_source_or_outbox_send(
    postgres_runtime: PostgresRuntime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = AcceptingResendClient()
    monkeypatch.setattr(mail_worker, "get_resend_client", lambda: client)
    account = await _create_account(postgres_runtime, label="rollback", activated=False)

    async with postgres_runtime.sessions() as db:
        stored_account = await db.get(Account, account.id)
        assert stored_account is not None
        token = await account_activation.issue_account_activation(db, stored_account)
        token_id = token.id
        await db.rollback()

    async with postgres_runtime.sessions() as db:
        assert await db.get(AccountActivationToken, token_id) is None
        assert (
            await db.scalar(
                select(func.count())
                .select_from(EmailOutbox)
                .where(EmailOutbox.source_id == token_id)
            )
            == 0
        )

    assert await mail_worker.run_email_outbox_batch(postgres_runtime.settings) == 0
    assert client.idempotency_keys == []


@pytest.mark.asyncio
async def test_two_concurrent_workers_claim_one_email_once(
    postgres_runtime: PostgresRuntime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = AcceptingResendClient()
    monkeypatch.setattr(mail_worker, "get_resend_client", lambda: client)
    account = await _create_account(postgres_runtime, label="concurrent")
    outbox_id, idempotency_key = await _enqueue_business_email(
        postgres_runtime, account, label="concurrent"
    )

    processed = await asyncio.gather(
        mail_worker.run_email_outbox_batch(postgres_runtime.settings),
        mail_worker.run_email_outbox_batch(postgres_runtime.settings),
    )

    outbox = await _get_outbox(postgres_runtime, outbox_id)
    assert sorted(processed) == [0, 1]
    assert client.idempotency_keys == [idempotency_key]
    assert outbox.status == EmailOutboxStatus.ACCEPTED.value
    assert outbox.attempt_count == 1
    async with postgres_runtime.sessions() as db:
        attempts = list(
            await db.scalars(
                select(EmailDeliveryAttempt).where(EmailDeliveryAttempt.outbox_id == outbox_id)
            )
        )
        assert len(attempts) == 1
        assert attempts[0].status == EmailOutboxStatus.ACCEPTED.value


@pytest.mark.asyncio
async def test_expired_lease_is_recovered_and_stale_worker_is_fenced(
    postgres_runtime: PostgresRuntime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = BlockingResendClient()
    monkeypatch.setattr(mail_worker, "get_resend_client", lambda: client)
    account = await _create_account(postgres_runtime, label="lease")
    outbox_id, idempotency_key = await _enqueue_business_email(
        postgres_runtime, account, label="lease"
    )
    stale_lock_token = str(uuid4())
    async with postgres_runtime.sessions() as db:
        outbox = await db.get(EmailOutbox, outbox_id)
        assert outbox is not None
        outbox.status = EmailOutboxStatus.PROCESSING.value
        outbox.attempt_count = 1
        outbox.lock_token = stale_lock_token
        outbox.locked_at = datetime.now(UTC) - timedelta(minutes=5)
        outbox.lock_expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()

    worker_task = asyncio.create_task(mail_worker.run_email_outbox_batch(postgres_runtime.settings))
    await asyncio.wait_for(client.started.wait(), timeout=5)

    claimed = await _get_outbox(postgres_runtime, outbox_id)
    assert claimed.status == EmailOutboxStatus.PROCESSING.value
    assert claimed.lock_token is not None
    assert claimed.lock_token != stale_lock_token
    assert claimed.attempt_count == 2

    await mail_worker._record_failure(
        postgres_runtime.settings,
        mail_worker.ClaimedEmail(id=outbox_id, lock_token=stale_lock_token),
        retryable=True,
        error_code="stale_worker",
        error_message="A stale worker must not mutate the reclaimed delivery.",
        outcome_uncertain=True,
        attempt_started_at=datetime.now(UTC) - timedelta(minutes=5),
    )
    still_claimed = await _get_outbox(postgres_runtime, outbox_id)
    assert still_claimed.status == EmailOutboxStatus.PROCESSING.value
    assert still_claimed.lock_token == claimed.lock_token
    assert still_claimed.last_error_code is None

    client.release.set()
    assert await asyncio.wait_for(worker_task, timeout=5) == 1

    completed = await _get_outbox(postgres_runtime, outbox_id)
    assert client.idempotency_keys == [idempotency_key]
    assert completed.status == EmailOutboxStatus.ACCEPTED.value
    assert completed.attempt_count == 2
    async with postgres_runtime.sessions() as db:
        attempts = list(
            await db.scalars(
                select(EmailDeliveryAttempt).where(EmailDeliveryAttempt.outbox_id == outbox_id)
            )
        )
        assert len(attempts) == 1
        assert attempts[0].attempt_number == 2


@pytest.mark.asyncio
async def test_transient_resend_timeout_retries_with_same_idempotency_key_then_accepts(
    postgres_runtime: PostgresRuntime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = TimeoutThenAcceptResendClient()
    monkeypatch.setattr(mail_worker, "get_resend_client", lambda: client)
    account = await _create_account(postgres_runtime, label="retry")
    outbox_id, idempotency_key = await _enqueue_business_email(
        postgres_runtime, account, label="retry"
    )

    assert await mail_worker.run_email_outbox_batch(postgres_runtime.settings) == 1
    first_attempt = await _get_outbox(postgres_runtime, outbox_id)
    assert first_attempt.status == EmailOutboxStatus.RETRY_SCHEDULED.value
    assert first_attempt.outcome_uncertain is True
    assert first_attempt.attempt_count == 1
    assert first_attempt.next_attempt_at > datetime.now(UTC)
    assert client.idempotency_keys == [idempotency_key]
    await _make_retry_due(postgres_runtime, outbox_id)

    assert await mail_worker.run_email_outbox_batch(postgres_runtime.settings) == 1
    completed = await _get_outbox(postgres_runtime, outbox_id)
    assert client.idempotency_keys == [idempotency_key, idempotency_key]
    assert completed.status == EmailOutboxStatus.ACCEPTED.value
    assert completed.outcome_uncertain is False
    assert completed.attempt_count == 2
    assert completed.provider_message_id is not None


@pytest.mark.asyncio
async def test_provider_acceptance_then_database_commit_failure_reuses_same_message(
    postgres_runtime: PostgresRuntime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = IdempotentAcceptingResendClient()
    monkeypatch.setattr(mail_worker, "get_resend_client", lambda: client)
    account = await _create_account(postgres_runtime, label="commit-failure")
    outbox_id, idempotency_key = await _enqueue_business_email(
        postgres_runtime, account, label="commit-failure"
    )
    failure_injected = False

    def fail_first_accepted_commit(session: Session) -> None:
        nonlocal failure_injected
        if failure_injected:
            return
        if any(
            isinstance(record, EmailOutbox) and record.status == EmailOutboxStatus.ACCEPTED.value
            for record in session.dirty
        ):
            failure_injected = True
            raise RuntimeError("Simulated database commit failure after provider acceptance.")

    event.listen(Session, "before_commit", fail_first_accepted_commit)
    try:
        assert await mail_worker.run_email_outbox_batch(postgres_runtime.settings) == 1
    finally:
        event.remove(Session, "before_commit", fail_first_accepted_commit)

    uncertain = await _get_outbox(postgres_runtime, outbox_id)
    assert failure_injected is True
    assert uncertain.status == EmailOutboxStatus.RETRY_SCHEDULED.value
    assert uncertain.outcome_uncertain is True
    assert uncertain.provider_message_id is None
    assert client.idempotency_keys == [idempotency_key]

    await _make_retry_due(postgres_runtime, outbox_id)
    assert await mail_worker.run_email_outbox_batch(postgres_runtime.settings) == 1

    completed = await _get_outbox(postgres_runtime, outbox_id)
    assert client.idempotency_keys == [idempotency_key, idempotency_key]
    assert len(client.provider_ids) == 1
    assert completed.provider_message_id == client.provider_ids[idempotency_key]
    assert completed.status == EmailOutboxStatus.ACCEPTED.value
    assert completed.attempt_count == 2


@pytest.mark.asyncio
async def test_permanent_provider_failure_is_dead_lettered_without_automatic_retry(
    postgres_runtime: PostgresRuntime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = PermanentlyRejectingResendClient()
    monkeypatch.setattr(mail_worker, "get_resend_client", lambda: client)
    account = await _create_account(postgres_runtime, label="permanent-failure")
    outbox_id, idempotency_key = await _enqueue_business_email(
        postgres_runtime, account, label="permanent-failure"
    )

    assert await mail_worker.run_email_outbox_batch(postgres_runtime.settings) == 1

    failed = await _get_outbox(postgres_runtime, outbox_id)
    assert client.idempotency_keys == [idempotency_key]
    assert failed.status == EmailOutboxStatus.TERMINAL_FAILED.value
    assert failed.last_error_code == "validation_error"
    assert failed.outcome_uncertain is False
    assert failed.attempt_count == 1
    assert await mail_worker.run_email_outbox_batch(postgres_runtime.settings) == 0


@pytest.mark.asyncio
async def test_transient_failure_reaching_attempt_ceiling_is_dead_lettered(
    postgres_runtime: PostgresRuntime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = TimeoutThenAcceptResendClient()
    monkeypatch.setattr(mail_worker, "get_resend_client", lambda: client)
    account = await _create_account(postgres_runtime, label="attempt-ceiling")
    outbox_id, idempotency_key = await _enqueue_business_email(
        postgres_runtime, account, label="attempt-ceiling"
    )
    async with postgres_runtime.sessions() as db:
        outbox = await db.get(EmailOutbox, outbox_id)
        assert outbox is not None
        outbox.max_attempts = 1
        await db.commit()

    assert await mail_worker.run_email_outbox_batch(postgres_runtime.settings) == 1

    failed = await _get_outbox(postgres_runtime, outbox_id)
    assert client.idempotency_keys == [idempotency_key]
    assert failed.status == EmailOutboxStatus.TERMINAL_FAILED.value
    assert failed.outcome_uncertain is True
    assert failed.attempt_count == failed.max_attempts == 1
    assert await mail_worker.run_email_outbox_batch(postgres_runtime.settings) == 0


@pytest.mark.asyncio
async def test_provider_payload_mutation_is_rejected_before_a_second_send(
    postgres_runtime: PostgresRuntime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = TimeoutThenAcceptResendClient()
    monkeypatch.setattr(mail_worker, "get_resend_client", lambda: client)
    account = await _create_account(postgres_runtime, label="payload")
    outbox_id, idempotency_key = await _enqueue_business_email(
        postgres_runtime, account, label="payload"
    )

    assert await mail_worker.run_email_outbox_batch(postgres_runtime.settings) == 1
    first_attempt = await _get_outbox(postgres_runtime, outbox_id)
    assert first_attempt.provider_payload_hash is not None

    async with postgres_runtime.sessions() as db:
        outbox = await db.get(EmailOutbox, outbox_id)
        assert outbox is not None
        payload = json.loads(outbox.template_payload_json)
        payload["displayName"] = "Mutated after the first provider attempt"
        outbox.template_payload_json = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        outbox.next_attempt_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()

    assert await mail_worker.run_email_outbox_batch(postgres_runtime.settings) == 1
    rejected = await _get_outbox(postgres_runtime, outbox_id)
    assert client.idempotency_keys == [idempotency_key]
    assert rejected.status == EmailOutboxStatus.TERMINAL_FAILED.value
    assert rejected.last_error_code == "payload_conflict"
    assert rejected.attempt_count == 2


@pytest.mark.asyncio
async def test_ambiguous_outcome_at_23_hours_requires_reconciliation(
    postgres_runtime: PostgresRuntime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = TimeoutThenAcceptResendClient()
    monkeypatch.setattr(mail_worker, "get_resend_client", lambda: client)
    account = await _create_account(postgres_runtime, label="reconcile")
    outbox_id, idempotency_key = await _enqueue_business_email(
        postgres_runtime, account, label="reconcile"
    )

    assert RESEND_IDEMPOTENCY_WINDOW - MANUAL_RETRY_SAFETY_MARGIN == timedelta(hours=23)
    assert await mail_worker.run_email_outbox_batch(postgres_runtime.settings) == 1
    await _make_retry_due(
        postgres_runtime,
        outbox_id,
        first_provider_attempt_at=datetime.now(UTC) - timedelta(hours=23),
    )

    assert await mail_worker.run_email_outbox_batch(postgres_runtime.settings) == 1
    outbox = await _get_outbox(postgres_runtime, outbox_id)
    assert client.idempotency_keys == [idempotency_key]
    assert outbox.status == EmailOutboxStatus.RECONCILIATION_REQUIRED.value
    assert outbox.last_error_code == "idempotency_window_elapsed"
    assert outbox.outcome_uncertain is True
    assert outbox.attempt_count == 2


@pytest.mark.asyncio
async def test_raw_activation_token_and_password_reset_code_are_never_persisted(
    postgres_runtime: PostgresRuntime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = AcceptingResendClient()
    monkeypatch.setattr(mail_worker, "get_resend_client", lambda: client)
    pending_account = await _create_account(
        postgres_runtime, label="secret-activation", activated=False
    )
    active_account = await _create_account(postgres_runtime, label="secret-otp")

    async with postgres_runtime.sessions() as db:
        stored_account = await db.get(Account, pending_account.id)
        assert stored_account is not None
        activation = await account_activation.issue_account_activation(db, stored_account)
        activation_id = activation.id
        await db.commit()
    async with postgres_runtime.sessions() as db:
        challenge = await password_recovery.request_password_reset(db, active_account.email)
        challenge_id = challenge.challenge_id

    raw_activation_token = secret_values.derive_account_activation_token(activation_id)
    raw_reset_code = secret_values.derive_password_reset_code(challenge_id)
    assert await mail_worker.run_email_outbox_batch(postgres_runtime.settings) == 2

    async with postgres_runtime.sessions() as db:
        stored_activation = await db.get(AccountActivationToken, activation_id)
        stored_challenge = await db.get(PasswordResetChallenge, challenge_id)
        outboxes = list(
            await db.scalars(
                select(EmailOutbox).where(EmailOutbox.source_id.in_((activation_id, challenge_id)))
            )
        )
        deliveries = list(
            await db.scalars(
                select(DevDelivery).where(
                    DevDelivery.account_id.in_((pending_account.id, active_account.id))
                )
            )
        )

    assert stored_activation is not None
    assert stored_challenge is not None
    assert stored_activation.token_hash != raw_activation_token
    assert len(stored_activation.token_hash) == 64
    assert stored_challenge.code_hash != raw_reset_code
    assert len(stored_challenge.code_hash) == 64
    assert len(outboxes) == 2
    for outbox in outboxes:
        payload = json.loads(outbox.template_payload_json)
        assert all(raw_activation_token not in value for value in payload.values())
        assert all(raw_reset_code not in value for value in payload.values())
        assert outbox.status == EmailOutboxStatus.ACCEPTED.value
    assert len(deliveries) == 2
    assert all(delivery.status == DeliveryStatus.ACCEPTED for delivery in deliveries)
    assert all(delivery.body == REDACTED_EMAIL_BODY for delivery in deliveries)
