from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo

import pytest
import pytest_asyncio
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.reporting.contracts import CanonicalReportingPeriod, monthly_reporting_period
from app.features.reporting.models import ReportingObligation, ReportingPeriod
from app.features.reporting.obligation_envelopes import ReminderIntentCommand
from app.features.reporting.obligations import create_reminder_intents, read_period_compliance
from app.features.reporting.periods import (
    ReportingPeriodForbidden,
    ReportingPeriodInvalidCursor,
    list_reporting_periods,
    read_reporting_period,
    run_reporting_period_lifecycle,
)
from app.features.topology.models import Enterprise, EnterpriseSite

TEST_DATABASE_ENV = "TANAW_TEST_DATABASE_URL"
MANILA = ZoneInfo("Asia/Manila")


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
async def period_engine() -> AsyncIterator[AsyncEngine]:
    raw_url = os.getenv(TEST_DATABASE_ENV)
    if not raw_url:
        pytest.skip(f"{TEST_DATABASE_ENV} is not configured.")
    engine = create_async_engine(_postgres_async_url(raw_url), pool_pre_ping=True)
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def period_session(period_engine: AsyncEngine) -> AsyncIterator[AsyncSession]:
    async with period_engine.connect() as connection:
        transaction = await connection.begin()
        session = AsyncSession(bind=connection, expire_on_commit=False)
        try:
            yield session
        finally:
            await session.close()
            await transaction.rollback()


@pytest.mark.asyncio
async def test_staff_lifecycle_discovers_empty_periods_and_freezes_pre_window_identity(
    period_session: AsyncSession,
) -> None:
    db = period_session
    staff = _account(AccountRole.STAFF)
    enterprise_account = _account(AccountRole.ENTERPRISE)
    admin = _account(AccountRole.ADMIN)
    suffix = uuid4().hex
    enterprise = Enterprise(
        id=str(uuid4()),
        official_code=f"PERIOD-{suffix}",
        name="Frozen Enterprise Name",
        classification="official",
        lifecycle_state="active",
    )
    site = EnterpriseSite(
        id=str(uuid4()),
        enterprise_id=enterprise.id,
        classification="official",
        site_code="PRIMARY",
        name="Frozen Site Name",
        barangay="Poblacion",
        timezone_name="Asia/Manila",
        building_capacity=100,
        location_version=1,
        effective_from=datetime(2026, 1, 1, tzinfo=UTC),
    )
    db.add_all([staff, enterprise_account, admin, enterprise])
    await db.flush()
    db.add(site)
    await db.flush()

    first_now = datetime(2026, 7, 10, 10, tzinfo=MANILA)
    first = await run_reporting_period_lifecycle(db, account=staff, now=first_now)
    assert first.contractVersion == 2
    assert first.ensuredPeriodCount == 4
    assert first.createdCount == 4
    assert first.frozenCount == 2
    assert [period.naturalKey for period in first.periods] == [
        "month:Asia/Manila:2026-06",
        "month:Asia/Manila:2026-07",
        "month:Asia/Manila:2026-08",
        "month:Asia/Manila:2026-09",
    ]
    june = first.periods[0]
    assert june.status == "open"
    assert june.startsAt == datetime(2026, 5, 31, 16, tzinfo=UTC)
    assert june.endsAt == datetime(2026, 6, 30, 16, tzinfo=UTC)
    assert june.submissionOpensAt == june.endsAt
    assert june.submissionClosesAt == june.endsAt + timedelta(days=15)

    closed = await run_reporting_period_lifecycle(
        db,
        account=staff,
        now=datetime(2026, 7, 16, 10, tzinfo=MANILA),
    )
    assert closed.createdCount == 0
    assert closed.transitionedCount == 1
    assert closed.periods[0].status == "closed"

    pre_window_now = datetime(2026, 7, 25, 10, tzinfo=MANILA)
    lead_run = await run_reporting_period_lifecycle(db, account=staff, now=pre_window_now)
    august = next(period for period in lead_run.periods if period.naturalKey.endswith("2026-08"))
    september = next(period for period in lead_run.periods if period.naturalKey.endswith("2026-09"))
    assert lead_run.frozenCount == 1
    assert august.obligationsFrozenAt == pre_window_now.astimezone(UTC)
    assert august.status == "scheduled"
    assert august.compliance.eligibleExpected >= 1
    assert august.compliance.notSubmitted == august.compliance.eligibleExpected
    assert september.obligationsFrozenAt is None
    assert september.compliance.totalFrozen == 0
    assert september.compliance.complete is False
    assert august.startsAt < august.endsAt
    assert august.endsAt == september.startsAt

    replay = await run_reporting_period_lifecycle(db, account=staff, now=pre_window_now)
    assert replay.createdCount == 0
    assert replay.transitionedCount == 0
    assert replay.frozenCount == 0

    first_page = await list_reporting_periods(
        db,
        account=staff,
        limit=2,
        cursor=None,
    )
    assert first_page.page.hasMore is True
    assert first_page.page.nextCursor is not None
    assert all(item.contractVersion == 2 for item in first_page.items)
    assert all(item.complianceClassification == "official" for item in first_page.items)
    second_page = await list_reporting_periods(
        db,
        account=staff,
        limit=2,
        cursor=first_page.page.nextCursor,
    )
    assert {item.reportingPeriodId for item in first_page.items}.isdisjoint(
        item.reportingPeriodId for item in second_page.items
    )
    with pytest.raises(ReportingPeriodInvalidCursor):
        await list_reporting_periods(
            db,
            account=staff,
            limit=2,
            cursor=first_page.page.nextCursor,
            period_status="scheduled",
        )
    with pytest.raises(ReportingPeriodInvalidCursor):
        await list_reporting_periods(db, account=staff, limit=2, cursor="")

    september_detail = await read_reporting_period(
        db,
        account=staff,
        reporting_period_id=september.reportingPeriodId,
    )
    assert september_detail.compliance.totalFrozen == 0
    assert september_detail.compliance.notSubmitted == 0

    august_row = await db.scalar(
        select(ReportingPeriod).where(ReportingPeriod.id == str(august.reportingPeriodId))
    )
    assert august_row is not None
    reminder = await create_reminder_intents(
        db,
        account=staff,
        reporting_period_id=UUID(august_row.id),
        command=ReminderIntentCommand(
            contractVersion=2,
            commandId=uuid4(),
        ),
        as_of=pre_window_now,
    )
    assert reminder.phase == "pre_window"
    assert reminder.createdCount == august.compliance.eligibleExpected

    enterprise.name = "Mutable New Enterprise Name"
    site.name = "Mutable New Site Name"
    await db.flush([enterprise, site])
    compliance = await read_period_compliance(
        db,
        account=staff,
        reporting_period_id=UUID(august_row.id),
    )
    frozen_identity = next(
        item for item in compliance.obligations if item.enterpriseId == UUID(enterprise.id)
    )
    assert frozen_identity.enterpriseName == "Frozen Enterprise Name"
    assert frozen_identity.siteName == "Frozen Site Name"
    assert frozen_identity.enterpriseOfficialCode == enterprise.official_code
    assert frozen_identity.siteCode == "PRIMARY"

    obligation = await db.scalar(
        select(ReportingObligation).where(
            ReportingObligation.reporting_period_id == august_row.id,
            ReportingObligation.enterprise_id == enterprise.id,
        )
    )
    assert obligation is not None
    with pytest.raises(DBAPIError, match="identity cannot be changed"):
        async with db.begin_nested():
            obligation.enterprise_name = "Rewritten history"
            await db.flush([obligation])
    await db.refresh(obligation)
    assert obligation.enterprise_name == "Frozen Enterprise Name"

    for denied_account in (enterprise_account, admin):
        with pytest.raises(ReportingPeriodForbidden):
            await list_reporting_periods(
                db,
                account=denied_account,
                limit=10,
                cursor=None,
            )
        with pytest.raises(ReportingPeriodForbidden):
            await read_reporting_period(
                db,
                account=denied_account,
                reporting_period_id=september.reportingPeriodId,
            )
        with pytest.raises(ReportingPeriodForbidden):
            await run_reporting_period_lifecycle(db, account=denied_account, now=pre_window_now)


@pytest.mark.asyncio
async def test_database_rejects_noncanonical_periods_and_has_migration_model_parity(
    period_session: AsyncSession,
) -> None:
    db = period_session
    canonical = monthly_reporting_period(2400 + uuid4().int % 500, 6)
    valid = _period_row(canonical, period_id=str(uuid4()))
    db.add(valid)
    await db.flush([valid])

    for mutation in ("key", "start", "close", "timezone"):
        invalid = _period_row(canonical, period_id=str(uuid4()))
        if mutation == "key":
            invalid.natural_key = f"legacy-label-{uuid4()}"
        elif mutation == "start":
            invalid.starts_at += timedelta(microseconds=1)
        elif mutation == "close":
            invalid.submission_closes_at += timedelta(seconds=1)
        else:
            invalid.timezone_name = ""
        with pytest.raises(DBAPIError, match="canonical"):
            async with db.begin_nested():
                db.add(invalid)
                await db.flush([invalid])

    schema = (
        await db.execute(
            text(
                """
                SELECT
                    EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'ex_reporting_periods_no_overlap'
                    ) AS overlap_guard,
                    EXISTS (
                        SELECT 1 FROM pg_trigger
                        WHERE tgname = 'trg_reporting_periods_canonical'
                          AND NOT tgisinternal
                    ) AS canonical_guard,
                    EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'ck_reporting_obligations_identity_snapshots'
                    ) AS identity_guard,
                    EXISTS (
                        SELECT 1 FROM pg_indexes
                        WHERE indexname = 'ix_reporting_periods_status_keyset'
                    ) AS discovery_index
                """
            )
        )
    ).one()
    assert tuple(schema) == (True, True, True, True)
    assert {
        "submission_closes_at",
        "status",
        "obligations_frozen_at",
    }.issubset(ReportingPeriod.__table__.c.keys())
    assert {
        "enterprise_official_code",
        "enterprise_name",
        "site_code",
        "site_name",
    }.issubset(ReportingObligation.__table__.c.keys())


@pytest.mark.asyncio
async def test_concurrent_canonical_period_inserts_cannot_overlap(
    period_engine: AsyncEngine,
) -> None:
    canonical = monthly_reporting_period(3100 + uuid4().int % 500, 1 + uuid4().int % 12)
    first_flushed = asyncio.Event()

    async def first_writer() -> None:
        async with AsyncSession(period_engine, expire_on_commit=False) as db:
            db.add(_period_row(canonical, period_id=str(uuid4())))
            await db.flush()
            first_flushed.set()
            await asyncio.sleep(0.05)
            await db.commit()

    async def conflicting_writer() -> None:
        await first_flushed.wait()
        async with AsyncSession(period_engine, expire_on_commit=False) as db:
            db.add(_period_row(canonical, period_id=str(uuid4())))
            with pytest.raises(IntegrityError):
                await db.commit()

    await asyncio.gather(first_writer(), conflicting_writer())


def _account(role: AccountRole) -> Account:
    now = datetime(2026, 1, 1, tzinfo=UTC)
    return Account(
        id=str(uuid4()),
        email=f"period-{role.value}-{uuid4().hex}@example.test",
        password_hash="not-used",
        role=role,
        display_name=f"Period {role.value}",
        title="Test account",
        status=AccountStatus.ACTIVE,
        activated_at=now,
    )


def _period_row(canonical: CanonicalReportingPeriod, *, period_id: str) -> ReportingPeriod:
    period = canonical
    return ReportingPeriod(
        id=period_id,
        natural_key=period.natural_key,
        cadence=period.cadence,
        timezone_name=period.timezone,
        local_start_date=period.local_start_date,
        local_end_date=period.local_end_date,
        starts_at=period.starts_at,
        ends_at=period.ends_at,
        submission_opens_at=period.submission_opens_at,
        submission_closes_at=period.submission_closes_at,
        status="scheduled",
        label=period.label,
    )
