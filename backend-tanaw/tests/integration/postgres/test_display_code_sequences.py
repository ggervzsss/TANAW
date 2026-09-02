import asyncio
import re
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, or_, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.config import Settings
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
)
from app.features.monitoring.alerts import create_operational_alert
from app.features.monitoring.models import OperationalAlert
from app.features.realtime.models import RealtimeOutbox
from app.features.support.models import SupportTicket
from app.features.support.schemas import SupportTicketCreate
from app.features.support.service import create_support_ticket
from tests.support.postgres import PostgresRuntime, postgres_test_database_url

TEST_EMAIL_PATTERN = "tanaw-display-code-pg-%@example.com"
TEST_SUBJECT_PREFIX = "Display code sequence test"
TEST_ALERT_REQUESTER_PREFIX = "Display Code Sequence Test"
CONCURRENT_CREATIONS = 12


@pytest_asyncio.fixture
async def postgres_runtime() -> AsyncIterator[PostgresRuntime]:
    database_url = postgres_test_database_url()
    engine = create_async_engine(database_url, pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    runtime = PostgresRuntime(
        engine=engine,
        sessions=sessions,
        settings=Settings(
            environment="development",
            database_url=database_url,
            jwt_secret_key="tanaw-display-code-postgres-jwt-secret-123456789",
        ),
    )
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
        ticket_ids = list(
            await db.scalars(
                select(SupportTicket.id).where(
                    SupportTicket.subject.startswith(TEST_SUBJECT_PREFIX)
                )
            )
        )
        alert_ids = list(
            await db.scalars(
                select(OperationalAlert.id).where(
                    OperationalAlert.requester.startswith(TEST_ALERT_REQUESTER_PREFIX)
                )
            )
        )
        outbox_conditions = []
        if ticket_ids:
            outbox_conditions.append(
                RealtimeOutbox.payload["ticket_id"].as_string().in_(ticket_ids)
            )
        if alert_ids:
            outbox_conditions.append(RealtimeOutbox.payload["alert_id"].as_string().in_(alert_ids))
        if outbox_conditions:
            await db.execute(delete(RealtimeOutbox).where(or_(*outbox_conditions)))
        if ticket_ids:
            await db.execute(delete(SupportTicket).where(SupportTicket.id.in_(ticket_ids)))
        if alert_ids:
            await db.execute(delete(OperationalAlert).where(OperationalAlert.id.in_(alert_ids)))
        if account_ids:
            await db.execute(delete(Account).where(Account.id.in_(account_ids)))
        await db.commit()


async def _create_enterprise(runtime: PostgresRuntime, *, label: str) -> str:
    suffix = uuid4().hex[:12]
    account = Account(
        id=str(uuid4()),
        email=f"tanaw-display-code-pg-{label}-{suffix}@example.com",
        password_hash="unused-display-code-test-password-hash",
        role=AccountRole.ENTERPRISE,
        display_name=f"Display Code Test {label}",
        title="Enterprise Account",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
        password_changed_at=datetime.now(UTC),
        enterprise_profile=EnterpriseProfile(
            enterprise_id=f"display-code-{label}-{suffix}",
            enterprise_name=f"Display Code Test {label}",
            category="business",
            manager_name=f"Display Code Test {label}",
            barangay="Poblacion",
        ),
    )
    async with runtime.sessions() as db:
        db.add(account)
        await db.commit()
    return account.id


def _ticket_payload(label: str) -> SupportTicketCreate:
    return SupportTicketCreate(
        category="Other",
        priority="Normal",
        subject=f"{TEST_SUBJECT_PREFIX} {label}",
        description="Verify PostgreSQL-backed support ticket display code allocation.",
        affectedArea="Enterprise portal",
    )


def _code_number(code: str, prefix: str) -> int:
    assert re.fullmatch(rf"{prefix}-\d{{6,}}", code)
    return int(code.removeprefix(f"{prefix}-"))


async def _create_ticket(
    runtime: PostgresRuntime, *, account_id: str, label: str
) -> tuple[str, str]:
    async with runtime.sessions() as db:
        account = await db.get(Account, account_id)
        assert account is not None
        ticket = await create_support_ticket(db, account, _ticket_payload(label))
        await db.commit()
        return ticket.id, ticket.code


async def _create_alert(
    runtime: PostgresRuntime, *, label: str, source_id: str | None = None
) -> tuple[str, str]:
    async with runtime.sessions() as db:
        alert = await create_operational_alert(
            db,
            alert_type="Maintenance Request",
            severity="Warning",
            requester=f"{TEST_ALERT_REQUESTER_PREFIX} {label}",
            summary="Verify PostgreSQL-backed operational alert display code allocation.",
            required_action="Inspect the test alert.",
            resolution_mode="Remote Review",
            owner="IT",
            source_id=source_id,
        )
        await db.commit()
        return alert.id, alert.alert_code


@pytest.mark.asyncio
async def test_support_ticket_sequence_allocates_monotonic_formatted_codes(
    postgres_runtime: PostgresRuntime,
) -> None:
    account_id = await _create_enterprise(postgres_runtime, label="ticket-sequential")
    first_id, first_code = await _create_ticket(
        postgres_runtime, account_id=account_id, label="sequential-one"
    )
    second_id, second_code = await _create_ticket(
        postgres_runtime, account_id=account_id, label="sequential-two"
    )

    assert first_id != second_id
    assert _code_number(second_code, "TCK") == _code_number(first_code, "TCK") + 1
    async with postgres_runtime.sessions() as db:
        assert await db.scalar(text("SELECT to_regclass('support_ticket_code_sequence')")) == (
            "support_ticket_code_sequence"
        )


@pytest.mark.asyncio
async def test_concurrent_support_tickets_receive_unique_codes(
    postgres_runtime: PostgresRuntime,
) -> None:
    account_id = await _create_enterprise(postgres_runtime, label="ticket-concurrent")
    start = asyncio.Event()

    async def create_one(index: int) -> str:
        await start.wait()
        _, code = await _create_ticket(
            postgres_runtime,
            account_id=account_id,
            label=f"concurrent-{index}",
        )
        return code

    tasks = [asyncio.create_task(create_one(index)) for index in range(CONCURRENT_CREATIONS)]
    start.set()
    codes = await asyncio.gather(*tasks)

    assert len(codes) == CONCURRENT_CREATIONS
    assert len(set(codes)) == CONCURRENT_CREATIONS
    assert all(_code_number(code, "TCK") > 0 for code in codes)


@pytest.mark.asyncio
async def test_support_ticket_deletion_and_rollback_do_not_reuse_codes(
    postgres_runtime: PostgresRuntime,
) -> None:
    account_id = await _create_enterprise(postgres_runtime, label="ticket-gaps")
    deleted_id, deleted_code = await _create_ticket(
        postgres_runtime, account_id=account_id, label="deleted"
    )
    async with postgres_runtime.sessions() as db:
        await db.execute(delete(SupportTicket).where(SupportTicket.id == deleted_id))
        await db.commit()

    async with postgres_runtime.sessions() as db:
        account = await db.get(Account, account_id)
        assert account is not None
        rolled_back = await create_support_ticket(db, account, _ticket_payload("rolled-back"))
        rolled_back_code = rolled_back.code
        await db.rollback()

    _, next_code = await _create_ticket(postgres_runtime, account_id=account_id, label="after-gaps")
    assert _code_number(rolled_back_code, "TCK") > _code_number(deleted_code, "TCK")
    assert _code_number(next_code, "TCK") > _code_number(rolled_back_code, "TCK")


@pytest.mark.asyncio
async def test_operational_alert_sequence_allocates_only_for_new_formatted_codes(
    postgres_runtime: PostgresRuntime,
) -> None:
    source_id = f"display-code-reuse-{uuid4()}"
    async with postgres_runtime.sessions() as db:
        first = await create_operational_alert(
            db,
            alert_type="Maintenance Request",
            severity="Warning",
            requester=f"{TEST_ALERT_REQUESTER_PREFIX} reuse-first",
            summary="Initial alert summary.",
            required_action="Inspect the test alert.",
            resolution_mode="Remote Review",
            owner="IT",
            source_id=source_id,
        )
        reused = await create_operational_alert(
            db,
            alert_type="Maintenance Request",
            severity="Critical",
            requester=f"{TEST_ALERT_REQUESTER_PREFIX} reuse-second",
            summary="Updated alert summary.",
            required_action="Inspect the updated test alert.",
            resolution_mode="Remote Review",
            owner="IT",
            source_id=source_id,
        )
        following = await create_operational_alert(
            db,
            alert_type="Maintenance Request",
            severity="Warning",
            requester=f"{TEST_ALERT_REQUESTER_PREFIX} following",
            summary="Following alert summary.",
            required_action="Inspect the following test alert.",
            resolution_mode="Remote Review",
            owner="IT",
            source_id=f"display-code-following-{uuid4()}",
        )
        await db.commit()

    assert reused.id == first.id
    assert reused.alert_code == first.alert_code
    assert _code_number(following.alert_code, "ALT") == _code_number(first.alert_code, "ALT") + 1
    async with postgres_runtime.sessions() as db:
        assert await db.scalar(text("SELECT to_regclass('operational_alert_code_sequence')")) == (
            "operational_alert_code_sequence"
        )


@pytest.mark.asyncio
async def test_concurrent_operational_alerts_receive_unique_codes(
    postgres_runtime: PostgresRuntime,
) -> None:
    start = asyncio.Event()

    async def create_one(index: int) -> str:
        await start.wait()
        _, code = await _create_alert(
            postgres_runtime,
            label=f"concurrent-{index}",
            source_id=f"display-code-concurrent-{uuid4()}",
        )
        return code

    tasks = [asyncio.create_task(create_one(index)) for index in range(CONCURRENT_CREATIONS)]
    start.set()
    codes = await asyncio.gather(*tasks)

    assert len(codes) == CONCURRENT_CREATIONS
    assert len(set(codes)) == CONCURRENT_CREATIONS
    assert all(_code_number(code, "ALT") > 0 for code in codes)


@pytest.mark.asyncio
async def test_operational_alert_deletion_and_rollback_do_not_reuse_codes(
    postgres_runtime: PostgresRuntime,
) -> None:
    deleted_id, deleted_code = await _create_alert(postgres_runtime, label="deleted")
    async with postgres_runtime.sessions() as db:
        await db.execute(delete(OperationalAlert).where(OperationalAlert.id == deleted_id))
        await db.commit()

    async with postgres_runtime.sessions() as db:
        rolled_back = await create_operational_alert(
            db,
            alert_type="Maintenance Request",
            severity="Warning",
            requester=f"{TEST_ALERT_REQUESTER_PREFIX} rolled-back",
            summary="Rolled-back alert summary.",
            required_action="Inspect the rolled-back test alert.",
            resolution_mode="Remote Review",
            owner="IT",
        )
        rolled_back_code = rolled_back.alert_code
        await db.rollback()

    _, next_code = await _create_alert(postgres_runtime, label="after-gaps")
    assert _code_number(rolled_back_code, "ALT") > _code_number(deleted_code, "ALT")
    assert _code_number(next_code, "ALT") > _code_number(rolled_back_code, "ALT")
