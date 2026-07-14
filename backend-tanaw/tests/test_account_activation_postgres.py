import asyncio
import base64
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
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
from app.core.security import hash_password, verify_password
from app.features.accounts.models import Account, AccountRole, AccountStatus, DevDelivery
from app.features.accounts.router import update_account_status, update_lgu_account
from app.features.accounts.schemas import AccountStatusUpdate, LguAccountUpdate
from app.features.accounts.service import NewEnterpriseTopology, create_account_with_activation
from app.features.activity_logs.models import ActivityLog
from app.features.auth import account_activation, secret_values
from app.features.auth import service as auth_service
from app.features.auth.models import AccountActivationToken, PasswordResetChallenge
from app.features.auth.secret_values import derive_account_activation_token
from app.features.mail import service as mail_service
from app.features.mail.models import EmailDeliveryAttempt, EmailOutbox, EmailOutboxStatus
from app.features.mail.rendering import render_outbox_email
from app.features.notifications.models import UserNotification
from app.features.topology.account_scope import enterprise_official_code_for_account
from app.features.topology.models import Enterprise, EnterpriseMembership, EnterpriseSite

TEST_DATABASE_ENV = "TANAW_TEST_DATABASE_URL"
TEST_EMAIL_PATTERN = "tanaw-activation-pg-%@example.com"
TEST_SECRET = "tanaw-activation-postgres-derivation-secret-123456789"


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
        jwt_secret_key="tanaw-activation-postgres-jwt-secret-123456789",
        email_delivery_mode="log",
        email_from_name="TANAW Activation PostgreSQL Test",
        email_from_address="no-reply@example.com",
        email_secret_derivation_key=SecretStr(TEST_SECRET),
        frontend_public_url="https://tanaw.example",
        account_activation_ttl_hours=24,
    )
    monkeypatch.setattr(account_activation, "get_settings", lambda: settings)
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
        token_ids = (
            list(
                await db.scalars(
                    select(AccountActivationToken.id).where(
                        AccountActivationToken.account_id.in_(account_ids)
                    )
                )
            )
            if account_ids
            else []
        )
        outbox_conditions = [EmailOutbox.recipient.like(TEST_EMAIL_PATTERN)]
        if token_ids:
            outbox_conditions.append(EmailOutbox.source_id.in_(token_ids))
        outbox_ids = list(await db.scalars(select(EmailOutbox.id).where(or_(*outbox_conditions))))
        if outbox_ids:
            await db.execute(
                delete(EmailDeliveryAttempt).where(EmailDeliveryAttempt.outbox_id.in_(outbox_ids))
            )
            await db.execute(delete(EmailOutbox).where(EmailOutbox.id.in_(outbox_ids)))
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
                    PasswordResetChallenge.account_id.in_(account_ids)
                )
            )
            await db.execute(
                delete(AccountActivationToken).where(
                    AccountActivationToken.account_id.in_(account_ids)
                )
            )
            await db.execute(delete(DevDelivery).where(DevDelivery.account_id.in_(account_ids)))
            await db.execute(delete(ActivityLog).where(ActivityLog.source_id.in_(account_ids)))
            await db.execute(
                delete(UserNotification).where(
                    UserNotification.recipient_account_id.in_(account_ids)
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


async def _create_pending_account(
    runtime: PostgresRuntime,
    *,
    label: str,
    role: AccountRole,
) -> Account:
    email = f"tanaw-activation-pg-{label}-{uuid4().hex}@example.com"
    enterprise_topology = (
        NewEnterpriseTopology(
            official_code=f"activation_{label}_{uuid4().hex[:8]}@tanaw.sanpedro",
            name=f"Activation Test {label} Enterprise",
            category="business",
            barangay="Poblacion",
            address="Activation Test Address, San Pedro, Laguna 4023",
            building_capacity=100,
        )
        if role == AccountRole.ENTERPRISE
        else None
    )
    async with runtime.sessions() as db:
        return await create_account_with_activation(
            db,
            email=email,
            phone="+639123456789",
            role=role,
            display_name=f"Activation Test {label}",
            title="Enterprise Account" if role == AccountRole.ENTERPRISE else "LGU Staff",
            first_name=None if role == AccountRole.ENTERPRISE else "Activation",
            last_name=None if role == AccountRole.ENTERPRISE else "Test",
            enterprise_topology=enterprise_topology,
        )


async def _create_active_it_actor(runtime: PostgresRuntime, *, label: str) -> Account:
    now = datetime.now(UTC)
    actor = Account(
        id=str(uuid4()),
        email=f"tanaw-activation-pg-{label}-{uuid4().hex}@example.com",
        phone=None,
        first_name="Activation",
        last_name="Administrator",
        password_hash=hash_password("Activation test administrator passphrase"),
        role=AccountRole.IT,
        display_name="Activation Test Administrator",
        title="IT Personnel",
        status=AccountStatus.ACTIVE,
        is_protected_system_account=False,
        activated_at=now,
        password_changed_at=now,
    )
    async with runtime.sessions() as db:
        db.add(actor)
        await db.commit()
    return actor


async def _current_token(runtime: PostgresRuntime, account_id: str) -> AccountActivationToken:
    async with runtime.sessions() as db:
        token = await db.scalar(
            select(AccountActivationToken)
            .where(
                AccountActivationToken.account_id == account_id,
                AccountActivationToken.consumed_at.is_(None),
                AccountActivationToken.invalidated_at.is_(None),
            )
            .order_by(AccountActivationToken.created_at.desc())
        )
        assert token is not None
        return token


@pytest.mark.asyncio
async def test_account_creation_activation_and_login_use_only_single_use_links(
    postgres_runtime: PostgresRuntime,
) -> None:
    lgu = await _create_pending_account(
        postgres_runtime,
        label="lifecycle-lgu",
        role=AccountRole.STAFF,
    )
    enterprise = await _create_pending_account(
        postgres_runtime,
        label="lifecycle-enterprise",
        role=AccountRole.ENTERPRISE,
    )

    for account in (lgu, enterprise):
        token = await _current_token(postgres_runtime, account.id)
        raw_token = derive_account_activation_token(token.id)
        decoded = base64.urlsafe_b64decode(f"{raw_token}=")
        assert len(decoded) == 32
        assert len(token.token_hash) == 64
        assert token.token_hash == account_activation._hash_token(raw_token)

        async with postgres_runtime.sessions() as db:
            stored = await db.get(Account, account.id)
            assert stored is not None
            assert stored.activated_at is None
            assert (
                await auth_service.authenticate_account(
                    db, stored.email, "Unknown pending password phrase"
                )
                is None
            )
            enterprise_code = await enterprise_official_code_for_account(db, stored)
            if enterprise_code:
                assert (
                    await auth_service.authenticate_account(
                        db, enterprise_code, "Unknown pending password phrase"
                    )
                    is None
                )

            details = await account_activation.validate_account_activation(db, raw_token)
            assert details.display_name == stored.display_name
            assert details.role == stored.role.value
            stored_token = await db.get(AccountActivationToken, token.id)
            assert stored_token is not None
            assert stored_token.consumed_at is None

            outbox = await db.scalar(select(EmailOutbox).where(EmailOutbox.source_id == token.id))
            assert outbox is not None
            assert outbox.status == EmailOutboxStatus.QUEUED.value
            persisted = f"{token.token_hash} {outbox.template_payload_json} {outbox.tags_json}"
            assert raw_token not in persisted
            assert "password" not in outbox.template_payload_json.lower()
            rendered = await render_outbox_email(db, outbox)
            assert f"/activate-account#token={raw_token}" in rendered.text
            assert "temporary password" not in rendered.text.lower()

    new_password = "LGU activation integration passphrase 2026"
    async with postgres_runtime.sessions() as db:
        lgu_token = await db.scalar(
            select(AccountActivationToken).where(AccountActivationToken.account_id == lgu.id)
        )
        assert lgu_token is not None
        raw_lgu_token = derive_account_activation_token(lgu_token.id)
        activated = await account_activation.complete_account_activation(
            db, raw_lgu_token, new_password
        )
        assert activated.activated_at is not None
        assert verify_password(new_password, activated.password_hash)

    async with postgres_runtime.sessions() as db:
        authenticated = await auth_service.authenticate_account(db, lgu.email, new_password)
        assert authenticated is not None
        assert authenticated.id == lgu.id
        with pytest.raises(account_activation.AccountActivationError, match="invalid or expired"):
            await account_activation.validate_account_activation(db, raw_lgu_token)


@pytest.mark.asyncio
async def test_resend_invalidates_every_older_link_and_cancels_queued_email(
    postgres_runtime: PostgresRuntime,
) -> None:
    account = await _create_pending_account(
        postgres_runtime,
        label="resend",
        role=AccountRole.STAFF,
    )
    first = await _current_token(postgres_runtime, account.id)
    first_raw = derive_account_activation_token(first.id)

    async with postgres_runtime.sessions() as db:
        stored = await db.get(Account, account.id)
        assert stored is not None
        second = await account_activation.issue_account_activation(db, stored)
        await db.commit()
        second_raw = derive_account_activation_token(second.id)

    async with postgres_runtime.sessions() as db:
        first_stored = await db.get(AccountActivationToken, first.id)
        second_stored = await db.get(AccountActivationToken, second.id)
        assert first_stored is not None
        assert second_stored is not None
        assert first_stored.invalidated_at is not None
        assert second_stored.invalidated_at is None
        first_outbox = await db.scalar(select(EmailOutbox).where(EmailOutbox.source_id == first.id))
        second_outbox = await db.scalar(
            select(EmailOutbox).where(EmailOutbox.source_id == second.id)
        )
        assert first_outbox is not None
        assert second_outbox is not None
        assert first_outbox.status == EmailOutboxStatus.CANCELLED.value
        assert second_outbox.status == EmailOutboxStatus.QUEUED.value
        with pytest.raises(account_activation.AccountActivationError, match="invalid or expired"):
            await account_activation.validate_account_activation(db, first_raw)
        assert (
            await account_activation.validate_account_activation(db, second_raw)
        ).role == "staff"


@pytest.mark.asyncio
async def test_pending_email_correction_rotates_delivery_and_deactivation_invalidates_it(
    postgres_runtime: PostgresRuntime,
) -> None:
    actor = await _create_active_it_actor(postgres_runtime, label="pending-email-actor")
    account = await _create_pending_account(
        postgres_runtime,
        label="pending-email-target",
        role=AccountRole.STAFF,
    )
    first = await _current_token(postgres_runtime, account.id)
    first_raw = derive_account_activation_token(first.id)
    corrected_email = f"tanaw-activation-pg-corrected-{uuid4().hex}@example.com"

    async with postgres_runtime.sessions() as db:
        stored_actor = await db.get(Account, actor.id)
        assert stored_actor is not None
        await update_lgu_account(
            account.id,
            LguAccountUpdate(
                firstName="Activation",
                lastName="Corrected",
                email=corrected_email,
                phone="+639123456789",
                role="staff",
                status="active",
            ),
            stored_actor,
            db,
        )

    second = await _current_token(postgres_runtime, account.id)
    second_raw = derive_account_activation_token(second.id)
    assert second.id != first.id
    async with postgres_runtime.sessions() as db:
        stored = await db.get(Account, account.id)
        first_stored = await db.get(AccountActivationToken, first.id)
        first_outbox = await db.scalar(select(EmailOutbox).where(EmailOutbox.source_id == first.id))
        second_outbox = await db.scalar(
            select(EmailOutbox).where(EmailOutbox.source_id == second.id)
        )
        assert stored is not None
        assert first_stored is not None
        assert first_outbox is not None
        assert second_outbox is not None
        assert stored.email == corrected_email
        assert first_stored.invalidated_at is not None
        assert first_outbox.status == EmailOutboxStatus.CANCELLED.value
        assert first_outbox.recipient == account.email
        assert second_outbox.status == EmailOutboxStatus.QUEUED.value
        assert second_outbox.recipient == corrected_email
        with pytest.raises(account_activation.AccountActivationError, match="invalid or expired"):
            await account_activation.validate_account_activation(db, first_raw)
        assert (
            await account_activation.validate_account_activation(db, second_raw)
        ).display_name == "Activation Corrected"

    async with postgres_runtime.sessions() as db:
        stored_actor = await db.get(Account, actor.id)
        assert stored_actor is not None
        await update_account_status(
            account.id,
            AccountStatusUpdate(status="inactive"),
            stored_actor,
            db,
        )

    async with postgres_runtime.sessions() as db:
        stored = await db.get(Account, account.id)
        second_stored = await db.get(AccountActivationToken, second.id)
        second_outbox = await db.scalar(
            select(EmailOutbox).where(EmailOutbox.source_id == second.id)
        )
        assert stored is not None
        assert second_stored is not None
        assert second_outbox is not None
        assert stored.status == AccountStatus.INACTIVE
        assert second_stored.invalidated_at is not None
        assert second_outbox.status == EmailOutboxStatus.CANCELLED.value
        with pytest.raises(account_activation.AccountActivationError, match="invalid or expired"):
            await account_activation.validate_account_activation(db, second_raw)


@pytest.mark.asyncio
async def test_two_concurrent_activation_completions_have_exactly_one_winner(
    postgres_runtime: PostgresRuntime,
) -> None:
    account = await _create_pending_account(
        postgres_runtime,
        label="concurrent",
        role=AccountRole.ENTERPRISE,
    )
    token = await _current_token(postgres_runtime, account.id)
    raw_token = derive_account_activation_token(token.id)
    start = asyncio.Event()

    async def attempt(password: str) -> tuple[str, str]:
        async with postgres_runtime.sessions() as db:
            await start.wait()
            try:
                await account_activation.complete_account_activation(db, raw_token, password)
            except account_activation.AccountActivationError as exc:
                await db.rollback()
                return "rejected", str(exc)
            return "activated", password

    first_password = "Concurrent enterprise activation phrase alpha"
    second_password = "Concurrent enterprise activation phrase beta"
    first_task = asyncio.create_task(attempt(first_password))
    second_task = asyncio.create_task(attempt(second_password))
    start.set()
    results = await asyncio.gather(first_task, second_task)

    assert [result[0] for result in results].count("activated") == 1
    assert [result[0] for result in results].count("rejected") == 1
    assert next(value for state, value in results if state == "rejected") == (
        "Activation link is invalid or expired."
    )

    winning_password = next(value for state, value in results if state == "activated")
    losing_password = second_password if winning_password == first_password else first_password
    async with postgres_runtime.sessions() as db:
        stored = await db.get(Account, account.id)
        stored_token = await db.get(AccountActivationToken, token.id)
        assert stored is not None
        assert stored_token is not None
        assert stored.activated_at is not None
        assert stored_token.consumed_at is not None
        assert verify_password(winning_password, stored.password_hash)
        assert not verify_password(losing_password, stored.password_hash)
        by_email = await auth_service.authenticate_account(db, stored.email, winning_password)
        enterprise_code = await enterprise_official_code_for_account(db, stored)
        assert enterprise_code is not None
        by_enterprise_id = await auth_service.authenticate_account(
            db, enterprise_code, winning_password
        )
        assert by_email is not None
        assert by_enterprise_id is not None
        assert by_email.id == account.id
        assert by_enterprise_id.id == account.id
