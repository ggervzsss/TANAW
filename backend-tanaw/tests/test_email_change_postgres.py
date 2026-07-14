import asyncio
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
import pytest_asyncio
from pydantic import SecretStr
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import Settings
from app.core.security import create_access_token, decode_access_token, hash_password
from app.features.accounts.dependencies import is_token_invalidated
from app.features.accounts.models import (
    Account,
    AccountEmailChangeRequest,
    AccountEmailChangeStatus,
    AccountRole,
    AccountStatus,
)
from app.features.accounts.router import update_account_status, update_lgu_account
from app.features.accounts.schemas import (
    AccountStatusUpdate,
    BusinessEmailChangeRequest,
    LguAccountUpdate,
)
from app.features.activity_logs.models import ActivityLog
from app.features.auth import email_change, secret_values
from app.features.auth import router as auth_router
from app.features.auth.models import AccountActivationToken, PasswordResetChallenge
from app.features.auth.secret_values import derive_account_email_change_token
from app.features.mail import service as mail_service
from app.features.mail.models import (
    EmailDeliveryAttempt,
    EmailOutbox,
    EmailOutboxStatus,
    EmailTemplateName,
)
from app.features.mail.rendering import render_outbox_email
from app.features.notifications.models import UserNotification
from app.features.topology.models import Enterprise, EnterpriseMembership, EnterpriseSite

TEST_DATABASE_ENV = "TANAW_TEST_DATABASE_URL"
TEST_EMAIL_PATTERN = "tanaw-email-change-pg-%@example.com"
TEST_SECRET = "tanaw-email-change-postgres-derivation-secret-123456789"


@dataclass(frozen=True)
class PostgresRuntime:
    engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    settings: Settings


@dataclass(frozen=True)
class CreatedAccount:
    id: str
    email: str


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
        jwt_secret_key="tanaw-email-change-postgres-jwt-secret-123456789",
        email_delivery_mode="log",
        email_from_name="TANAW Email Change PostgreSQL Test",
        email_from_address="no-reply@example.com",
        email_secret_derivation_key=SecretStr(TEST_SECRET),
        account_email_change_ttl_hours=24,
    )
    monkeypatch.setattr(email_change, "get_settings", lambda: settings)
    monkeypatch.setattr(secret_values, "get_settings", lambda: settings)
    monkeypatch.setattr(mail_service, "get_settings", lambda: settings)

    runtime = PostgresRuntime(engine=engine, sessions=sessions, settings=settings)
    await _clean_rows(runtime)
    try:
        yield runtime
    finally:
        await _clean_rows(runtime)
        await engine.dispose()


async def _clean_rows(runtime: PostgresRuntime) -> None:
    async with runtime.sessions() as db:
        accounts = list(
            await db.scalars(select(Account).where(Account.email.like(TEST_EMAIL_PATTERN)))
        )
        account_ids = [account.id for account in accounts]
        requests = (
            list(
                await db.scalars(
                    select(AccountEmailChangeRequest).where(
                        or_(
                            AccountEmailChangeRequest.account_id.in_(account_ids),
                            AccountEmailChangeRequest.old_email.like(TEST_EMAIL_PATTERN),
                            AccountEmailChangeRequest.requested_email.like(TEST_EMAIL_PATTERN),
                        )
                    )
                )
            )
            if account_ids
            else []
        )
        request_ids = [request.id for request in requests]
        outbox_conditions = [EmailOutbox.recipient.like(TEST_EMAIL_PATTERN)]
        if request_ids:
            outbox_conditions.append(EmailOutbox.source_id.in_(request_ids))
        outbox_ids = list(await db.scalars(select(EmailOutbox.id).where(or_(*outbox_conditions))))
        if outbox_ids:
            await db.execute(
                delete(EmailDeliveryAttempt).where(EmailDeliveryAttempt.outbox_id.in_(outbox_ids))
            )
            await db.execute(delete(EmailOutbox).where(EmailOutbox.id.in_(outbox_ids)))
        if account_ids or request_ids:
            await db.execute(
                delete(ActivityLog).where(
                    or_(
                        ActivityLog.source_id.in_(account_ids or ["missing"]),
                        ActivityLog.source_id.in_(request_ids or ["missing"]),
                    )
                )
            )
            await db.execute(
                delete(UserNotification).where(
                    or_(
                        UserNotification.recipient_account_id.in_(account_ids or ["missing"]),
                        UserNotification.source_id.in_(request_ids or ["missing"]),
                    )
                )
            )
        if account_ids:
            enterprise_ids = list(
                await db.scalars(
                    select(EnterpriseMembership.enterprise_id).where(
                        EnterpriseMembership.account_id.in_(account_ids)
                    )
                )
            )
            await db.execute(
                delete(PasswordResetChallenge).where(
                    or_(
                        PasswordResetChallenge.account_id.in_(account_ids),
                        PasswordResetChallenge.email.like(TEST_EMAIL_PATTERN),
                    )
                )
            )
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
            if enterprise_ids:
                await db.execute(
                    delete(EnterpriseSite).where(EnterpriseSite.enterprise_id.in_(enterprise_ids))
                )
                await db.execute(
                    delete(EnterpriseMembership).where(
                        EnterpriseMembership.enterprise_id.in_(enterprise_ids)
                    )
                )
                await db.execute(delete(Enterprise).where(Enterprise.id.in_(enterprise_ids)))
            await db.execute(delete(Account).where(Account.id.in_(account_ids)))
        await db.commit()


async def _create_account(
    runtime: PostgresRuntime,
    *,
    label: str,
    role: AccountRole,
    activated: bool = True,
) -> CreatedAccount:
    now = datetime.now(UTC)
    account = Account(
        id=str(uuid4()),
        email=f"tanaw-email-change-pg-{label}-{uuid4().hex}@example.com",
        phone="+639123456789",
        first_name="Test",
        last_name=label,
        password_hash=hash_password("Existing-Password-For-Email-Change1!"),
        role=role,
        display_name=f"Email Change Test {label}",
        title="PostgreSQL email-change test",
        status=AccountStatus.ACTIVE,
        is_protected_system_account=False,
        activated_at=now if activated else None,
        password_changed_at=now if activated else None,
    )
    async with runtime.sessions() as db:
        db.add(account)
        await db.flush()
        if role == AccountRole.ENTERPRISE:
            enterprise = Enterprise(
                official_code=f"test_{label}_{uuid4().hex[:8]}@tanaw.sanpedro",
                name=f"Test {label}",
                classification="official",
                lifecycle_state="active",
            )
            db.add(enterprise)
            await db.flush()
            db.add_all(
                [
                    EnterpriseMembership(
                        enterprise_id=enterprise.id,
                        account_id=account.id,
                        classification="official",
                        membership_role="manager",
                        started_at=now,
                    ),
                    EnterpriseSite(
                        enterprise_id=enterprise.id,
                        classification="official",
                        site_code="primary",
                        name=f"Test {label} Primary Site",
                        barangay="Poblacion",
                        address="Email Change Test, San Pedro, Laguna 4023",
                        building_capacity=100,
                        effective_from=now,
                    ),
                ]
            )
        await db.commit()
    return CreatedAccount(id=account.id, email=account.email)


async def _request_change(
    runtime: PostgresRuntime,
    *,
    account: CreatedAccount,
    actor: CreatedAccount,
    requested_email: str,
) -> tuple[str, str]:
    async with runtime.sessions() as db:
        stored_actor = await db.get(Account, actor.id)
        assert stored_actor is not None
        _, request = await email_change.request_account_email_change(
            db,
            account_id=account.id,
            requested_email=requested_email,
            requested_by=stored_actor,
        )
        await db.commit()
        return request.id, derive_account_email_change_token(request.id)


@pytest.mark.asyncio
async def test_email_change_stores_only_token_hash_and_queues_both_notices(
    postgres_runtime: PostgresRuntime,
) -> None:
    account = await _create_account(postgres_runtime, label="hash", role=AccountRole.ENTERPRISE)
    requested_email = f"tanaw-email-change-pg-hash-new-{uuid4().hex}@example.com"
    request_id, raw_token = await _request_change(
        postgres_runtime,
        account=account,
        actor=account,
        requested_email=requested_email,
    )

    async with postgres_runtime.sessions() as db:
        request = await db.get(AccountEmailChangeRequest, request_id)
        assert request is not None
        assert request.token_hash == secret_values.hash_account_email_change_token(raw_token)
        assert not hasattr(request, "token")
        assert not hasattr(request, "raw_token")
        outboxes = list(
            await db.scalars(select(EmailOutbox).where(EmailOutbox.source_id == request_id))
        )
        assert {(outbox.template_name, outbox.recipient) for outbox in outboxes} == {
            (EmailTemplateName.ACCOUNT_EMAIL_CHANGE_VERIFICATION.value, requested_email),
            (EmailTemplateName.ACCOUNT_EMAIL_CHANGE_REQUEST_NOTICE.value, account.email),
        }
        persisted_text = " ".join(
            [
                request.token_hash or "",
                *(outbox.template_payload_json for outbox in outboxes),
                *(outbox.tags_json or "" for outbox in outboxes),
            ]
        )
        assert raw_token not in persisted_text

        verification_outbox = next(
            outbox
            for outbox in outboxes
            if outbox.template_name == EmailTemplateName.ACCOUNT_EMAIL_CHANGE_VERIFICATION.value
        )
        rendered = await render_outbox_email(db, verification_outbox)
        assert f"/verify-email-change#token={raw_token}" in rendered.text


@pytest.mark.asyncio
async def test_secondary_notification_failure_does_not_report_request_as_failed(
    postgres_runtime: PostgresRuntime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = await _create_account(
        postgres_runtime,
        label="notification-failure",
        role=AccountRole.ENTERPRISE,
    )
    requested_email = f"tanaw-email-change-pg-notification-new-{uuid4().hex}@example.com"
    notify = AsyncMock(side_effect=RuntimeError("simulated notification database failure"))
    monkeypatch.setattr(auth_router, "notify_enterprise_account_change", notify)

    async with postgres_runtime.sessions() as db:
        stored_account = await db.get(Account, account.id)
        assert stored_account is not None
        response = await auth_router.request_business_email_change(
            BusinessEmailChangeRequest(email=requested_email),
            stored_account,
            db,
        )
        assert response.status == "pending_verification"

    async with postgres_runtime.sessions() as db:
        request = await db.scalar(
            select(AccountEmailChangeRequest).where(
                AccountEmailChangeRequest.account_id == account.id,
                AccountEmailChangeRequest.status
                == AccountEmailChangeStatus.PENDING_VERIFICATION.value,
            )
        )
        assert request is not None
        outboxes = list(
            await db.scalars(select(EmailOutbox).where(EmailOutbox.source_id == request.id))
        )
        assert len(outboxes) == 2


@pytest.mark.asyncio
async def test_replacement_single_use_expiry_cancellation_and_rejection(
    postgres_runtime: PostgresRuntime,
) -> None:
    account = await _create_account(
        postgres_runtime, label="lifecycle", role=AccountRole.ENTERPRISE
    )
    first_email = f"tanaw-email-change-pg-first-{uuid4().hex}@example.com"
    first_id, first_token = await _request_change(
        postgres_runtime,
        account=account,
        actor=account,
        requested_email=first_email,
    )
    second_email = f"tanaw-email-change-pg-second-{uuid4().hex}@example.com"
    second_id, second_token = await _request_change(
        postgres_runtime,
        account=account,
        actor=account,
        requested_email=second_email,
    )

    async with postgres_runtime.sessions() as db:
        first = await db.get(AccountEmailChangeRequest, first_id)
        assert first is not None
        assert first.status == AccountEmailChangeStatus.REPLACED.value
        assert first.token_hash is None
        first_outboxes = list(
            await db.scalars(select(EmailOutbox).where(EmailOutbox.source_id == first_id))
        )
        assert {outbox.status for outbox in first_outboxes} == {EmailOutboxStatus.CANCELLED.value}
        with pytest.raises(email_change.AccountEmailChangeError, match="invalid or expired"):
            await email_change.verify_account_email_change(db, first_token)

    async with postgres_runtime.sessions() as db:
        verified = await email_change.verify_account_email_change(db, second_token)
        assert verified.requested_email == second_email
        with pytest.raises(email_change.AccountEmailChangeError, match="invalid or expired"):
            await email_change.verify_account_email_change(db, second_token)

    async with postgres_runtime.sessions() as db:
        cancelled = await email_change.cancel_account_email_change(db, account_id=account.id)
        assert cancelled.id == second_id
        assert cancelled.status == AccountEmailChangeStatus.CANCELLED.value

    expired_email = f"tanaw-email-change-pg-expired-{uuid4().hex}@example.com"
    expired_id, expired_token = await _request_change(
        postgres_runtime,
        account=account,
        actor=account,
        requested_email=expired_email,
    )
    async with postgres_runtime.sessions() as db:
        request = await db.get(AccountEmailChangeRequest, expired_id)
        assert request is not None
        request.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()
        with pytest.raises(email_change.AccountEmailChangeError, match="invalid or expired"):
            await email_change.verify_account_email_change(db, expired_token)
    async with postgres_runtime.sessions() as db:
        expired = await db.get(AccountEmailChangeRequest, expired_id)
        assert expired is not None
        assert expired.status == AccountEmailChangeStatus.EXPIRED.value
        assert expired.token_hash is None

    rejected_email = f"tanaw-email-change-pg-rejected-{uuid4().hex}@example.com"
    rejected_id, rejected_token = await _request_change(
        postgres_runtime,
        account=account,
        actor=account,
        requested_email=rejected_email,
    )
    async with postgres_runtime.sessions() as db:
        await email_change.verify_account_email_change(db, rejected_token)
    it = await _create_account(postgres_runtime, label="reject-it", role=AccountRole.IT)
    async with postgres_runtime.sessions() as db:
        stored_it = await db.get(Account, it.id)
        assert stored_it is not None
        _, rejected = await email_change.resolve_account_email_change(
            db,
            account_id=account.id,
            actor=stored_it,
            approve=False,
        )
        assert rejected.id == rejected_id
        assert rejected.status == AccountEmailChangeStatus.REJECTED.value


@pytest.mark.asyncio
async def test_approval_requires_verification_and_invalidates_recovery_state(
    postgres_runtime: PostgresRuntime,
) -> None:
    account = await _create_account(postgres_runtime, label="approve", role=AccountRole.ENTERPRISE)
    it = await _create_account(postgres_runtime, label="approve-it", role=AccountRole.IT)
    requested_email = f"tanaw-email-change-pg-approved-{uuid4().hex}@example.com"
    request_id, raw_token = await _request_change(
        postgres_runtime,
        account=account,
        actor=account,
        requested_email=requested_email,
    )
    stale_session = decode_access_token(create_access_token(account.id))
    challenge_id = f"email-change-challenge-{uuid4().hex}"
    async with postgres_runtime.sessions() as db:
        db.add(
            PasswordResetChallenge(
                id=challenge_id,
                email=account.email,
                account_id=account.id,
                code_hash="0" * 64,
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        await db.commit()
        stored_it = await db.get(Account, it.id)
        assert stored_it is not None
        with pytest.raises(email_change.AccountEmailChangeError, match="must open"):
            await email_change.resolve_account_email_change(
                db,
                account_id=account.id,
                actor=stored_it,
                approve=True,
            )

    async with postgres_runtime.sessions() as db:
        await email_change.verify_account_email_change(db, raw_token)
    async with postgres_runtime.sessions() as db:
        stored_it = await db.get(Account, it.id)
        assert stored_it is not None
        updated, resolved = await email_change.resolve_account_email_change(
            db,
            account_id=account.id,
            actor=stored_it,
            approve=True,
        )
        assert updated.email == requested_email
        assert updated.token_invalid_before is not None
        assert is_token_invalidated(stale_session, updated) is True
        assert resolved.status == AccountEmailChangeStatus.APPROVED.value

    async with postgres_runtime.sessions() as db:
        challenge = await db.get(PasswordResetChallenge, challenge_id)
        assert challenge is not None
        assert challenge.invalidated_at is not None
        notices = list(
            await db.scalars(select(EmailOutbox).where(EmailOutbox.source_id == request_id))
        )
        assert {
            (notice.template_name, notice.recipient)
            for notice in notices
            if notice.template_name
            in {
                EmailTemplateName.ACCOUNT_EMAIL_CHANGE_APPROVED_OLD.value,
                EmailTemplateName.ACCOUNT_EMAIL_CHANGE_APPROVED_NEW.value,
            }
        } == {
            (EmailTemplateName.ACCOUNT_EMAIL_CHANGE_APPROVED_OLD.value, account.email),
            (EmailTemplateName.ACCOUNT_EMAIL_CHANGE_APPROVED_NEW.value, requested_email),
        }


@pytest.mark.asyncio
async def test_deactivation_invalidates_pending_email_change(
    postgres_runtime: PostgresRuntime,
) -> None:
    account = await _create_account(
        postgres_runtime,
        label="deactivate-target",
        role=AccountRole.ENTERPRISE,
    )
    it = await _create_account(postgres_runtime, label="deactivate-it", role=AccountRole.IT)
    requested_email = f"tanaw-email-change-pg-deactivate-new-{uuid4().hex}@example.com"
    request_id, _ = await _request_change(
        postgres_runtime,
        account=account,
        actor=account,
        requested_email=requested_email,
    )
    stale_session = decode_access_token(create_access_token(account.id))

    async with postgres_runtime.sessions() as db:
        actor = await db.get(Account, it.id)
        assert actor is not None
        response = await update_account_status(
            account.id,
            AccountStatusUpdate(status="inactive"),
            actor,
            db,
        )
        assert response.status == AccountStatus.INACTIVE.value
        assert response.profileChangeRequests == []

    async with postgres_runtime.sessions() as db:
        stored_account = await db.get(Account, account.id)
        request = await db.get(AccountEmailChangeRequest, request_id)
        assert stored_account is not None
        assert request is not None
        assert is_token_invalidated(stale_session, stored_account) is True
        assert request.status == AccountEmailChangeStatus.CANCELLED.value
        assert request.token_hash is None
        outboxes = list(
            await db.scalars(select(EmailOutbox).where(EmailOutbox.source_id == request_id))
        )
        assert {outbox.status for outbox in outboxes} == {EmailOutboxStatus.CANCELLED.value}


@pytest.mark.asyncio
async def test_role_change_invalidates_sessions_and_recovery_challenges(
    postgres_runtime: PostgresRuntime,
) -> None:
    target = await _create_account(postgres_runtime, label="role-target", role=AccountRole.STAFF)
    it = await _create_account(postgres_runtime, label="role-it", role=AccountRole.IT)
    stale_session = decode_access_token(create_access_token(target.id))
    challenge_id = f"role-change-challenge-{uuid4().hex}"

    async with postgres_runtime.sessions() as db:
        db.add(
            PasswordResetChallenge(
                id=challenge_id,
                email=target.email,
                account_id=target.id,
                code_hash="0" * 64,
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        await db.commit()
        actor = await db.get(Account, it.id)
        assert actor is not None
        response = await update_lgu_account(
            target.id,
            LguAccountUpdate(
                firstName="Test",
                lastName="Role",
                email=target.email,
                phone="+639123456789",
                role="admin",
                status="active",
            ),
            actor,
            db,
        )
        assert response.role == AccountRole.ADMIN.value

    async with postgres_runtime.sessions() as db:
        stored_account = await db.get(Account, target.id)
        challenge = await db.get(PasswordResetChallenge, challenge_id)
        assert stored_account is not None
        assert challenge is not None
        assert is_token_invalidated(stale_session, stored_account) is True
        assert challenge.invalidated_at is not None


@pytest.mark.asyncio
async def test_it_direct_edit_cannot_bypass_verification_or_self_approve(
    postgres_runtime: PostgresRuntime,
) -> None:
    target = await _create_account(postgres_runtime, label="direct-target", role=AccountRole.STAFF)
    requesting_it = await _create_account(
        postgres_runtime, label="direct-it-one", role=AccountRole.IT
    )
    approving_it = await _create_account(
        postgres_runtime, label="direct-it-two", role=AccountRole.IT
    )
    requested_email = f"tanaw-email-change-pg-direct-new-{uuid4().hex}@example.com"

    async with postgres_runtime.sessions() as db:
        actor = await db.get(Account, requesting_it.id)
        assert actor is not None
        response = await update_lgu_account(
            target.id,
            LguAccountUpdate(
                firstName="Test",
                lastName="Direct",
                email=requested_email,
                phone="+639123456789",
                role="staff",
                status="active",
            ),
            actor,
            db,
        )
        assert response.email == target.email
        assert len(response.profileChangeRequests) == 1
        assert response.profileChangeRequests[0].requestedValue == requested_email
        request_id = response.profileChangeRequests[0].requestId
        assert request_id is not None

    raw_token = derive_account_email_change_token(request_id)
    async with postgres_runtime.sessions() as db:
        await email_change.verify_account_email_change(db, raw_token)
    async with postgres_runtime.sessions() as db:
        actor = await db.get(Account, requesting_it.id)
        assert actor is not None
        with pytest.raises(email_change.AccountEmailChangeError, match="different IT Personnel"):
            await email_change.resolve_account_email_change(
                db,
                account_id=target.id,
                actor=actor,
                approve=True,
            )
    async with postgres_runtime.sessions() as db:
        actor = await db.get(Account, approving_it.id)
        assert actor is not None
        updated, _ = await email_change.resolve_account_email_change(
            db,
            account_id=target.id,
            actor=actor,
            approve=True,
        )
        assert updated.email == requested_email


@pytest.mark.asyncio
async def test_concurrent_approvals_have_exactly_one_winner(
    postgres_runtime: PostgresRuntime,
) -> None:
    account = await _create_account(
        postgres_runtime, label="concurrent", role=AccountRole.ENTERPRISE
    )
    first_it = await _create_account(
        postgres_runtime, label="concurrent-it-one", role=AccountRole.IT
    )
    second_it = await _create_account(
        postgres_runtime, label="concurrent-it-two", role=AccountRole.IT
    )
    requested_email = f"tanaw-email-change-pg-concurrent-new-{uuid4().hex}@example.com"
    request_id, raw_token = await _request_change(
        postgres_runtime,
        account=account,
        actor=account,
        requested_email=requested_email,
    )
    async with postgres_runtime.sessions() as db:
        await email_change.verify_account_email_change(db, raw_token)

    async def approve(actor_id: str) -> object:
        async with postgres_runtime.sessions() as db:
            actor = await db.get(Account, actor_id)
            assert actor is not None
            try:
                return await email_change.resolve_account_email_change(
                    db,
                    account_id=account.id,
                    actor=actor,
                    approve=True,
                )
            except email_change.AccountEmailChangeError as exc:
                return exc

    results = await asyncio.gather(approve(first_it.id), approve(second_it.id))
    assert sum(isinstance(result, tuple) for result in results) == 1
    assert sum(isinstance(result, email_change.AccountEmailChangeError) for result in results) == 1

    async with postgres_runtime.sessions() as db:
        stored_account = await db.get(Account, account.id)
        request = await db.get(AccountEmailChangeRequest, request_id)
        assert stored_account is not None
        assert request is not None
        assert stored_account.email == requested_email
        assert request.status == AccountEmailChangeStatus.APPROVED.value
        approval_notices = list(
            await db.scalars(
                select(EmailOutbox).where(
                    EmailOutbox.source_id == request_id,
                    EmailOutbox.template_name.in_(
                        (
                            EmailTemplateName.ACCOUNT_EMAIL_CHANGE_APPROVED_OLD.value,
                            EmailTemplateName.ACCOUNT_EMAIL_CHANGE_APPROVED_NEW.value,
                        )
                    ),
                )
            )
        )
        assert len(approval_notices) == 2


@pytest.mark.asyncio
async def test_replacement_racing_with_approval_preserves_verified_current_email(
    postgres_runtime: PostgresRuntime,
) -> None:
    account = await _create_account(
        postgres_runtime, label="replace-race", role=AccountRole.ENTERPRISE
    )
    it = await _create_account(postgres_runtime, label="replace-race-it", role=AccountRole.IT)
    verified_email = f"tanaw-email-change-pg-race-verified-{uuid4().hex}@example.com"
    initial_request_id, raw_token = await _request_change(
        postgres_runtime,
        account=account,
        actor=account,
        requested_email=verified_email,
    )
    async with postgres_runtime.sessions() as db:
        await email_change.verify_account_email_change(db, raw_token)

    replacement_email = f"tanaw-email-change-pg-race-replacement-{uuid4().hex}@example.com"

    async def approve_verified_request() -> object:
        async with postgres_runtime.sessions() as db:
            actor = await db.get(Account, it.id)
            assert actor is not None
            try:
                return await email_change.resolve_account_email_change(
                    db,
                    account_id=account.id,
                    actor=actor,
                    approve=True,
                )
            except email_change.AccountEmailChangeError as exc:
                return exc

    async def submit_replacement() -> object:
        async with postgres_runtime.sessions() as db:
            owner = await db.get(Account, account.id)
            assert owner is not None
            try:
                _, request = await email_change.request_account_email_change(
                    db,
                    account_id=account.id,
                    requested_email=replacement_email,
                    requested_by=owner,
                )
                await db.commit()
                return request
            except email_change.AccountEmailChangeError as exc:
                return exc

    approval_result, replacement_result = await asyncio.gather(
        approve_verified_request(),
        submit_replacement(),
    )
    assert isinstance(replacement_result, AccountEmailChangeRequest)
    assert isinstance(approval_result, tuple) or isinstance(
        approval_result, email_change.AccountEmailChangeError
    )

    async with postgres_runtime.sessions() as db:
        stored_account = await db.get(Account, account.id)
        initial_request = await db.get(AccountEmailChangeRequest, initial_request_id)
        replacement_request = await db.get(AccountEmailChangeRequest, replacement_result.id)
        assert stored_account is not None
        assert initial_request is not None
        assert replacement_request is not None
        assert stored_account.email in {account.email, verified_email}
        assert stored_account.email != replacement_email
        assert replacement_request.old_email == stored_account.email
        assert replacement_request.status == AccountEmailChangeStatus.PENDING_VERIFICATION.value
        assert initial_request.status in {
            AccountEmailChangeStatus.APPROVED.value,
            AccountEmailChangeStatus.REPLACED.value,
        }
