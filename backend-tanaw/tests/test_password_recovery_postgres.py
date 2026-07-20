import asyncio
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import HTTPException, Request, Response, status
from pydantic import SecretStr
from sqlalchemy import delete, event, func, or_, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import Settings
from app.core.security import (
    create_access_token,
    decode_access_token,
    hash_password,
    verify_password,
)
from app.features.accounts.dependencies import is_token_invalidated
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.activity_logs.models import ActivityLog
from app.features.auth import password_recovery, recovery_rate_limit, secret_values
from app.features.auth import router as auth_router
from app.features.auth.models import (
    AccountActivationToken,
    PasswordResetChallenge,
    PasswordResetRateLimitBucket,
)
from app.features.auth.recovery_rate_limit import (
    PasswordResetRateContext,
    PasswordResetRateLimitExceeded,
    consume_password_reset_rate_limits,
    password_reset_rate_context,
)
from app.features.auth.schemas import (
    ForgotPasswordRequest,
    ForgotPasswordRequestResponse,
    LoginRequest,
    LoginResponse,
)
from app.features.auth.secret_values import derive_password_reset_code
from app.features.mail import service as mail_service
from app.features.mail.models import EmailDeliveryAttempt, EmailOutbox, EmailOutboxStatus

TEST_DATABASE_ENV = "TANAW_TEST_DATABASE_URL"
TEST_EMAIL_PATTERN = "tanaw-recovery-pg-%@example.com"
TEST_RATE_BUCKET_PREFIX = "tanaw-recovery-pg:"
TEST_DERIVATION_SECRET = "tanaw-recovery-postgres-test-secret-123456789"
OLD_PASSWORD = "Recovery-Old-Password1!"


@dataclass(frozen=True)
class PostgresRuntime:
    engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    settings: Settings


@dataclass(frozen=True)
class CreatedAccount:
    id: str
    email: str
    password: str


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
        jwt_secret_key="tanaw-recovery-postgres-jwt-secret-123456789",
        email_delivery_mode="log",
        email_from_name="TANAW Recovery PostgreSQL Test",
        email_from_address="no-reply@example.com",
        email_secret_derivation_key=SecretStr(TEST_DERIVATION_SECRET),
        password_reset_rate_window_seconds=300,
        password_reset_per_ip_limit=100,
        password_reset_per_identifier_limit=50,
        password_reset_global_limit=1_000,
        password_reset_resend_cooldown_seconds=60,
        password_reset_response_floor_seconds=0,
    )

    original_increment_bucket = recovery_rate_limit._increment_bucket

    async def increment_isolated_test_bucket(
        db: AsyncSession,
        *,
        scope: str,
        bucket_key: str,
        now: datetime,
        window: timedelta,
        counter_cap: int,
        limit: int,
    ) -> tuple[int, datetime, bool]:
        return await original_increment_bucket(
            db,
            scope=scope,
            bucket_key=f"{TEST_RATE_BUCKET_PREFIX}{bucket_key}",
            now=now,
            window=window,
            counter_cap=counter_cap,
            limit=limit,
        )

    monkeypatch.setattr(recovery_rate_limit, "_increment_bucket", increment_isolated_test_bucket)
    monkeypatch.setattr(password_recovery, "get_settings", lambda: settings)
    monkeypatch.setattr(auth_router, "get_settings", lambda: settings)
    monkeypatch.setattr(mail_service, "get_settings", lambda: settings)

    monkeypatch.setattr(secret_values, "get_settings", lambda: settings)

    runtime = PostgresRuntime(engine=engine, sessions=sessions, settings=settings)
    await _clean_postgres_rows(runtime)
    try:
        yield runtime
    finally:
        await _clean_postgres_rows(runtime)
        await engine.dispose()


async def _clean_postgres_rows(runtime: PostgresRuntime) -> None:
    async with runtime.sessions() as db:
        accounts = list(
            await db.scalars(select(Account).where(Account.email.like(TEST_EMAIL_PATTERN)))
        )
        challenges = list(
            await db.scalars(
                select(PasswordResetChallenge).where(
                    PasswordResetChallenge.email.like(TEST_EMAIL_PATTERN)
                )
            )
        )
        account_ids = [account.id for account in accounts]
        challenge_ids = [challenge.id for challenge in challenges]
        test_emails = {account.email for account in accounts} | {
            challenge.email for challenge in challenges
        }

        outbox_conditions = [EmailOutbox.recipient.like(TEST_EMAIL_PATTERN)]
        if challenge_ids:
            outbox_conditions.append(EmailOutbox.source_id.in_(challenge_ids))
        outbox_ids = list(await db.scalars(select(EmailOutbox.id).where(or_(*outbox_conditions))))
        if outbox_ids:
            await db.execute(
                delete(EmailDeliveryAttempt).where(EmailDeliveryAttempt.outbox_id.in_(outbox_ids))
            )
            await db.execute(delete(EmailOutbox).where(EmailOutbox.id.in_(outbox_ids)))

        activity_source_ids = set(account_ids)
        for email in test_emails:
            context = password_reset_rate_context(
                runtime.settings,
                normalized_email=email,
                client_ip="cleanup-not-used",
            )
            activity_source_ids.add(f"password-recovery:{context.identifier_hash[:32]}")
        for challenge_id in challenge_ids:
            fingerprint = password_recovery._audit_fingerprint("challenge", challenge_id)
            activity_source_ids.add(f"password-recovery-challenge:{fingerprint[:32]}")
        if activity_source_ids:
            await db.execute(
                delete(ActivityLog).where(ActivityLog.source_id.in_(activity_source_ids))
            )

        await db.execute(
            delete(PasswordResetRateLimitBucket).where(
                PasswordResetRateLimitBucket.bucket_key.like(f"{TEST_RATE_BUCKET_PREFIX}%")
            )
        )
        if account_ids:
            await db.execute(
                delete(AccountActivationToken).where(
                    AccountActivationToken.account_id.in_(account_ids)
                )
            )
        if challenge_ids:
            await db.execute(
                delete(PasswordResetChallenge).where(PasswordResetChallenge.id.in_(challenge_ids))
            )
        if account_ids:
            await db.execute(delete(Account).where(Account.id.in_(account_ids)))
        await db.commit()


async def _create_account(
    runtime: PostgresRuntime,
    *,
    label: str,
    status_value: AccountStatus = AccountStatus.ACTIVE,
    activated: bool = True,
    password: str = OLD_PASSWORD,
) -> CreatedAccount:
    account_id = str(uuid4())
    email = f"tanaw-recovery-pg-{label}-{uuid4().hex}@example.com"
    now = datetime.now(UTC)
    account = Account(
        id=account_id,
        email=email,
        phone=None,
        password_hash=hash_password(password),
        role=AccountRole.STAFF,
        display_name=f"Recovery PostgreSQL Test {label}",
        title="PostgreSQL recovery integration test",
        status=status_value,
        is_protected_system_account=False,
        activated_at=now if activated else None,
        password_changed_at=now if activated else None,
    )
    async with runtime.sessions() as db:
        db.add(account)
        await db.commit()
    return CreatedAccount(id=account_id, email=email, password=password)


async def _request_reset(
    runtime: PostgresRuntime,
    email: str,
    *,
    client_ip: str,
) -> password_recovery.PasswordResetRequestResult:
    async with runtime.sessions() as db:
        return await password_recovery.request_password_reset(
            db,
            email,
            client_ip=client_ip,
        )


async def _request_reset_api(
    runtime: PostgresRuntime,
    email: str,
    *,
    client_ip: str,
) -> ForgotPasswordRequestResponse:
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/auth/forgot-password/request",
            "headers": [],
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "client": (client_ip, 12345),
        }
    )
    async with runtime.sessions() as db:
        return await auth_router.forgot_password_request(
            request,
            ForgotPasswordRequest(email=email),
            db,
        )


async def _issue_active_challenge(
    runtime: PostgresRuntime,
    *,
    label: str,
) -> tuple[CreatedAccount, password_recovery.PasswordResetRequestResult, str]:
    account = await _create_account(runtime, label=label)
    request_result = await _request_reset(
        runtime,
        account.email,
        client_ip=f"198.51.100.{int(uuid4().hex[:2], 16)}",
    )
    return account, request_result, derive_password_reset_code(request_result.challenge_id)


@pytest.mark.asyncio
async def test_request_result_is_generic_for_every_account_state(
    postgres_runtime: PostgresRuntime,
) -> None:
    active = await _create_account(postgres_runtime, label="generic-active")
    pending = await _create_account(
        postgres_runtime,
        label="generic-pending",
        activated=False,
    )
    inactive = await _create_account(
        postgres_runtime,
        label="generic-inactive",
        status_value=AccountStatus.INACTIVE,
    )
    unknown_email = f"tanaw-recovery-pg-generic-unknown-{uuid4().hex}@example.com"

    emails = [active.email, pending.email, inactive.email, unknown_email]
    results = [
        await _request_reset_api(
            postgres_runtime,
            email,
            client_ip=f"203.0.113.{index + 10}",
        )
        for index, email in enumerate(emails)
    ]

    expected_fields = {
        "challengeId",
        "expiresInMinutes",
        "resendAvailableInSeconds",
        "message",
    }
    assert all(set(result.model_dump()) == expected_fields for result in results)
    assert len({result.challengeId for result in results}) == len(results)
    assert len({result.message for result in results}) == 1
    assert all(result.expiresInMinutes == password_recovery.OTP_TTL_MINUTES for result in results)
    assert all(
        result.resendAvailableInSeconds
        == postgres_runtime.settings.password_reset_resend_cooldown_seconds
        for result in results
    )
    assert all("eligible TANAW account" in result.message for result in results)

    async with postgres_runtime.sessions() as db:
        challenges = list(
            await db.scalars(
                select(PasswordResetChallenge).where(PasswordResetChallenge.email.in_(emails))
            )
        )
        outbox_recipients = list(
            await db.scalars(
                select(EmailOutbox.recipient).where(EmailOutbox.recipient.like(TEST_EMAIL_PATTERN))
            )
        )
        security_logs = list(
            await db.scalars(
                select(ActivityLog).where(ActivityLog.action == "Password Recovery Request")
            )
        )
        rate_bucket_keys = list(
            await db.scalars(
                select(PasswordResetRateLimitBucket.bucket_key).where(
                    PasswordResetRateLimitBucket.bucket_key.like(f"{TEST_RATE_BUCKET_PREFIX}%")
                )
            )
        )

    challenges_by_email = {challenge.email: challenge for challenge in challenges}
    assert challenges_by_email[active.email].account_id == active.id
    assert challenges_by_email[pending.email].account_id is None
    assert challenges_by_email[inactive.email].account_id is None
    assert challenges_by_email[unknown_email].account_id is None
    assert outbox_recipients == [active.email]
    protected_telemetry = repr(
        [(log.target, log.source_id, log.metadata_json) for log in security_logs]
    ) + repr(rate_bucket_keys)
    assert all(email not in protected_telemetry for email in emails)
    assert all(f"203.0.113.{index + 10}" not in protected_telemetry for index in range(4))


@pytest.mark.asyncio
async def test_resend_cooldown_reuses_challenge_without_extending_or_requeueing(
    postgres_runtime: PostgresRuntime,
) -> None:
    account = await _create_account(postgres_runtime, label="cooldown")
    first = await _request_reset(
        postgres_runtime,
        account.email,
        client_ip="198.51.100.20",
    )
    async with postgres_runtime.sessions() as db:
        first_challenge = await db.get(PasswordResetChallenge, first.challenge_id)
        assert first_challenge is not None
        original_expiry = first_challenge.expires_at

    second = await _request_reset(
        postgres_runtime,
        account.email,
        client_ip="198.51.100.20",
    )

    async with postgres_runtime.sessions() as db:
        stored = await db.get(PasswordResetChallenge, first.challenge_id)
        assert stored is not None
        outbox_count = await db.scalar(
            select(func.count())
            .select_from(EmailOutbox)
            .where(EmailOutbox.recipient == account.email)
        )
        challenge_count = await db.scalar(
            select(func.count())
            .select_from(PasswordResetChallenge)
            .where(PasswordResetChallenge.email == account.email)
        )

    assert second.challenge_id == first.challenge_id
    assert second.reused_challenge is True
    assert second.expires_in_minutes <= first.expires_in_minutes
    assert 1 <= second.resend_available_in_seconds <= first.resend_available_in_seconds
    assert stored.expires_at == original_expiry
    assert challenge_count == 1
    assert outbox_count == 1


@pytest.mark.asyncio
async def test_new_request_invalidates_older_challenge_and_cancels_its_email(
    postgres_runtime: PostgresRuntime,
) -> None:
    account = await _create_account(postgres_runtime, label="older-challenge")
    first = await _request_reset(
        postgres_runtime,
        account.email,
        client_ip="198.51.100.30",
    )
    async with postgres_runtime.sessions() as db:
        older = await db.get(PasswordResetChallenge, first.challenge_id)
        assert older is not None
        older.created_at = datetime.now(UTC) - timedelta(minutes=2)
        await db.commit()

    second = await _request_reset(
        postgres_runtime,
        account.email,
        client_ip="198.51.100.30",
    )

    async with postgres_runtime.sessions() as db:
        older = await db.get(PasswordResetChallenge, first.challenge_id)
        current = await db.get(PasswordResetChallenge, second.challenge_id)
        older_outbox = await db.scalar(
            select(EmailOutbox).where(EmailOutbox.source_id == first.challenge_id)
        )
        current_outbox = await db.scalar(
            select(EmailOutbox).where(EmailOutbox.source_id == second.challenge_id)
        )

    assert second.challenge_id != first.challenge_id
    assert older is not None
    assert older.used is True
    assert older.code_consumed is True
    assert older.code_hash == ""
    assert older.invalidated_at is not None
    assert current is not None
    assert current.used is False
    assert current.invalidated_at is None
    assert older_outbox is not None
    assert older_outbox.status == EmailOutboxStatus.CANCELLED.value
    assert current_outbox is not None
    assert current_outbox.status == EmailOutboxStatus.QUEUED.value


@pytest.mark.parametrize(
    ("bounded_scope", "limit", "attempt_count"),
    (("identifier", 2, 8), ("ip", 2, 8), ("global", 10, 20)),
)
@pytest.mark.asyncio
async def test_concurrent_rate_limits_are_atomically_bounded(
    postgres_runtime: PostgresRuntime,
    bounded_scope: str,
    limit: int,
    attempt_count: int,
) -> None:
    overrides = {
        "password_reset_per_identifier_limit": 50,
        "password_reset_per_ip_limit": 100,
        "password_reset_global_limit": 1_000,
    }
    if bounded_scope == "global":
        overrides["password_reset_global_limit"] = limit
    elif bounded_scope == "identifier":
        overrides["password_reset_per_identifier_limit"] = limit
    else:
        overrides["password_reset_per_ip_limit"] = limit
    settings = postgres_runtime.settings.model_copy(update=overrides)

    contexts: list[PasswordResetRateContext] = []
    for index in range(attempt_count):
        email_index = 0 if bounded_scope == "identifier" else index
        ip_index = 0 if bounded_scope == "ip" else index
        contexts.append(
            password_reset_rate_context(
                settings,
                normalized_email=(
                    f"tanaw-recovery-pg-rate-{bounded_scope}-{email_index}@example.com"
                ),
                client_ip=f"192.0.2.{ip_index + 1}",
            )
        )

    started_at = datetime.now(UTC)

    async def consume_once(
        context: PasswordResetRateContext,
        offset: int,
    ) -> PasswordResetRateLimitExceeded | None:
        async with postgres_runtime.sessions() as db:
            try:
                await consume_password_reset_rate_limits(
                    db,
                    settings,
                    context,
                    now=started_at + timedelta(microseconds=offset),
                )
            except PasswordResetRateLimitExceeded as exc:
                await db.commit()
                return exc
            await db.commit()
            return None

    outcomes = await asyncio.gather(
        *(consume_once(context, index) for index, context in enumerate(contexts))
    )
    successes = [outcome for outcome in outcomes if outcome is None]
    failures = [outcome for outcome in outcomes if outcome is not None]

    if bounded_scope == "global":
        original_bucket_key = "password-reset:global"
    elif bounded_scope == "identifier":
        original_bucket_key = f"password-reset:identifier:{contexts[0].identifier_hash}"
    else:
        original_bucket_key = f"password-reset:ip:{contexts[0].ip_hash}"
    async with postgres_runtime.sessions() as db:
        bucket = await db.get(
            PasswordResetRateLimitBucket,
            f"{TEST_RATE_BUCKET_PREFIX}{original_bucket_key}",
        )
        identifier_bucket_count = await db.scalar(
            select(func.count())
            .select_from(PasswordResetRateLimitBucket)
            .where(
                PasswordResetRateLimitBucket.bucket_key.like(
                    f"{TEST_RATE_BUCKET_PREFIX}password-reset:identifier:%"
                )
            )
        )

    assert len(successes) == limit
    assert len(failures) == attempt_count - limit
    assert all(outcome.exceeded_scopes == (bounded_scope,) for outcome in failures)
    assert sum(outcome.should_record_event for outcome in failures) == 1
    assert bucket is not None
    assert bucket.request_count == limit + 1
    assert bucket.blocked_at is not None
    if bounded_scope == "global":
        assert identifier_bucket_count == limit


@pytest.mark.asyncio
async def test_two_concurrent_correct_otp_verifications_only_consume_once(
    postgres_runtime: PostgresRuntime,
) -> None:
    _, request_result, code = await _issue_active_challenge(
        postgres_runtime,
        label="concurrent-correct-otp",
    )

    async def verify_once() -> str | password_recovery.PasswordRecoveryError:
        async with postgres_runtime.sessions() as db:
            try:
                return await password_recovery.verify_password_reset_code(
                    db,
                    request_result.challenge_id,
                    code,
                )
            except password_recovery.PasswordRecoveryError as exc:
                return exc

    outcomes = await asyncio.gather(verify_once(), verify_once())
    successful_tokens = [outcome for outcome in outcomes if isinstance(outcome, str)]
    failures = [
        outcome
        for outcome in outcomes
        if isinstance(outcome, password_recovery.PasswordRecoveryError)
    ]

    async with postgres_runtime.sessions() as db:
        challenge = await db.get(PasswordResetChallenge, request_result.challenge_id)
        outbox = await db.scalar(
            select(EmailOutbox).where(EmailOutbox.source_id == request_result.challenge_id)
        )

    assert len(successful_tokens) == 1
    assert len(failures) == 1
    assert challenge is not None
    assert challenge.attempts == 1
    assert challenge.verified is True
    assert challenge.code_consumed is True
    assert challenge.code_hash == ""
    assert challenge.reset_token_hash is not None
    assert outbox is not None
    assert outbox.status == EmailOutboxStatus.CANCELLED.value


@pytest.mark.asyncio
async def test_concurrent_invalid_otp_attempts_increment_without_lost_updates(
    postgres_runtime: PostgresRuntime,
) -> None:
    _, request_result, code = await _issue_active_challenge(
        postgres_runtime,
        label="concurrent-invalid-otp",
    )
    wrong_code = "000000" if code != "000000" else "999999"
    concurrent_attempts = password_recovery.MAX_OTP_ATTEMPTS - 1

    async def verify_invalid_once() -> password_recovery.PasswordRecoveryError:
        async with postgres_runtime.sessions() as db:
            with pytest.raises(password_recovery.PasswordRecoveryError) as error:
                await password_recovery.verify_password_reset_code(
                    db,
                    request_result.challenge_id,
                    wrong_code,
                )
            return error.value

    failures = await asyncio.gather(*(verify_invalid_once() for _ in range(concurrent_attempts)))

    async with postgres_runtime.sessions() as db:
        challenge = await db.get(PasswordResetChallenge, request_result.challenge_id)

    assert len(failures) == concurrent_attempts
    assert challenge is not None
    assert challenge.attempts == concurrent_attempts
    assert challenge.used is False
    assert challenge.code_consumed is False
    assert challenge.invalidated_at is None


@pytest.mark.asyncio
async def test_two_concurrent_password_resets_have_exactly_one_winner(
    postgres_runtime: PostgresRuntime,
) -> None:
    account, request_result, code = await _issue_active_challenge(
        postgres_runtime,
        label="concurrent-reset",
    )
    stale_session = decode_access_token(create_access_token(account.id))
    async with postgres_runtime.sessions() as db:
        reset_token = await password_recovery.verify_password_reset_code(
            db,
            request_result.challenge_id,
            code,
        )

    candidate_passwords = ("Recovery-Winner-One1!", "Recovery-Winner-Two2!")

    async def reset_once(
        candidate_password: str,
    ) -> str | password_recovery.PasswordRecoveryError:
        async with postgres_runtime.sessions() as db:
            try:
                await password_recovery.reset_password_with_token(
                    db,
                    challenge_id=request_result.challenge_id,
                    reset_token=reset_token,
                    new_password=candidate_password,
                )
            except password_recovery.PasswordRecoveryError as exc:
                return exc
            return candidate_password

    outcomes = await asyncio.gather(*(reset_once(password) for password in candidate_passwords))
    winners = [outcome for outcome in outcomes if isinstance(outcome, str)]
    failures = [
        outcome
        for outcome in outcomes
        if isinstance(outcome, password_recovery.PasswordRecoveryError)
    ]

    async with postgres_runtime.sessions() as db:
        stored_account = await db.get(Account, account.id)
        challenge = await db.get(PasswordResetChallenge, request_result.challenge_id)

    assert len(winners) == 1
    assert len(failures) == 1
    assert stored_account is not None
    assert verify_password(winners[0], stored_account.password_hash)
    losing_password = next(password for password in candidate_passwords if password != winners[0])
    assert not verify_password(losing_password, stored_account.password_hash)
    assert challenge is not None
    assert challenge.used is True
    assert challenge.used_at is not None
    assert challenge.reset_token_hash is None
    assert is_token_invalidated(stale_session, stored_account) is True


@pytest.mark.asyncio
async def test_password_reset_serializes_before_old_password_login(
    postgres_runtime: PostgresRuntime,
) -> None:
    account, request_result, code = await _issue_active_challenge(
        postgres_runtime,
        label="reset-versus-login",
    )
    async with postgres_runtime.sessions() as db:
        reset_token = await password_recovery.verify_password_reset_code(
            db,
            request_result.challenge_id,
            code,
        )

    new_password = "Recovery-New-Password2!"
    first_account_lock_query = asyncio.Event()
    second_account_lock_query = asyncio.Event()
    observed_account_lock_queries = 0

    def observe_account_lock_query(
        _connection: object,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        nonlocal observed_account_lock_queries
        normalized = " ".join(statement.lower().split())
        if " from accounts " not in f" {normalized} " or " for update" not in normalized:
            return
        observed_account_lock_queries += 1
        if observed_account_lock_queries == 1:
            first_account_lock_query.set()
        elif observed_account_lock_queries == 2:
            second_account_lock_query.set()

    async def run_reset() -> Account | Exception:
        async with postgres_runtime.sessions() as db:
            try:
                return await password_recovery.reset_password_with_token(
                    db,
                    challenge_id=request_result.challenge_id,
                    reset_token=reset_token,
                    new_password=new_password,
                )
            except Exception as exc:  # pragma: no cover - assertion reports unexpected failures
                return exc

    async def run_old_password_login() -> LoginResponse | HTTPException | Exception:
        async with postgres_runtime.sessions() as db:
            try:
                return await auth_router.login(
                    LoginRequest(
                        username=account.email,
                        password=account.password,
                        loginScope="web",
                    ),
                    Response(),
                    db,
                )
            except HTTPException as exc:
                return exc
            except Exception as exc:  # pragma: no cover - assertion reports unexpected failures
                return exc

    reset_task: asyncio.Task[Account | Exception] | None = None
    login_task: asyncio.Task[LoginResponse | HTTPException | Exception] | None = None
    async with postgres_runtime.sessions() as lock_holder:
        await lock_holder.scalar(select(Account).where(Account.id == account.id).with_for_update())
        event.listen(
            postgres_runtime.engine.sync_engine,
            "before_cursor_execute",
            observe_account_lock_query,
        )
        try:
            reset_task = asyncio.create_task(run_reset())
            await asyncio.wait_for(first_account_lock_query.wait(), timeout=5)
            login_task = asyncio.create_task(run_old_password_login())
            await asyncio.wait_for(second_account_lock_query.wait(), timeout=5)
            await lock_holder.commit()
            reset_outcome, login_outcome = await asyncio.gather(reset_task, login_task)
        finally:
            event.remove(
                postgres_runtime.engine.sync_engine,
                "before_cursor_execute",
                observe_account_lock_query,
            )
            for task in (reset_task, login_task):
                if task is not None and not task.done():
                    task.cancel()
            if lock_holder.in_transaction():
                await lock_holder.rollback()

    async with postgres_runtime.sessions() as db:
        stored_account = await db.get(Account, account.id)

    assert isinstance(reset_outcome, Account)
    assert isinstance(login_outcome, HTTPException)
    assert login_outcome.status_code == status.HTTP_401_UNAUTHORIZED
    assert stored_account is not None
    assert verify_password(new_password, stored_account.password_hash)
    assert not verify_password(account.password, stored_account.password_hash)
    assert stored_account.failed_login_attempts == 1
