import json
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.events.models import DomainEvent, DomainEventDelivery
from app.features.reporting.contracts import monthly_reporting_period
from app.features.reporting.models import ReportingObligation, ReportingPeriod
from app.features.reporting.obligation_envelopes import (
    ObligationFreezeCommand,
    ReminderIntentCommand,
)
from app.features.reporting.obligations import (
    ObligationConflict,
    create_reminder_intents,
    freeze_period_obligations,
    read_period_compliance,
)
from app.features.simulation.models import SimulationRun
from app.features.topology.models import (
    Enterprise,
    EnterpriseMembership,
    EnterpriseSite,
    SiteLocationVersion,
)

TEST_DATABASE_ENV = "TANAW_TEST_DATABASE_URL"


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
async def obligation_session() -> AsyncIterator[AsyncSession]:
    raw_url = os.getenv(TEST_DATABASE_ENV)
    if not raw_url:
        pytest.skip(f"{TEST_DATABASE_ENV} is not configured.")

    engine = create_async_engine(_postgres_async_url(raw_url), pool_pre_ping=True)
    async with engine.connect() as connection:
        transaction = await connection.begin()
        session = AsyncSession(bind=connection, expire_on_commit=False)
        try:
            yield session
        finally:
            await session.close()
            await transaction.rollback()
    await engine.dispose()


@pytest.mark.asyncio
async def test_period_freeze_is_historical_role_scoped_and_reminders_are_idempotent(
    obligation_session: AsyncSession,
) -> None:
    db = obligation_session
    suffix = uuid4().hex
    technical_now = datetime(2026, 7, 13, tzinfo=UTC)
    effective_last_year = datetime(2025, 1, 1, tzinfo=UTC)
    canonical = monthly_reporting_period(2025, 6)
    period = ReportingPeriod(
        id=str(uuid4()),
        natural_key=canonical.natural_key,
        cadence="month",
        timezone_name=canonical.timezone,
        local_start_date=canonical.local_start_date,
        local_end_date=canonical.local_end_date,
        starts_at=canonical.starts_at,
        ends_at=canonical.ends_at,
        submission_opens_at=canonical.submission_opens_at,
        submission_closes_at=canonical.submission_closes_at,
        status="closed",
        label="June 2025",
    )
    other_canonical = monthly_reporting_period(2025, 7)
    other_period = ReportingPeriod(
        id=str(uuid4()),
        natural_key=other_canonical.natural_key,
        cadence="month",
        timezone_name=other_canonical.timezone,
        local_start_date=other_canonical.local_start_date,
        local_end_date=other_canonical.local_end_date,
        starts_at=other_canonical.starts_at,
        ends_at=other_canonical.ends_at,
        submission_opens_at=other_canonical.submission_opens_at,
        submission_closes_at=other_canonical.submission_closes_at,
        status="closed",
        label="July 2025",
    )
    staff = _account("staff", suffix, technical_now)
    admin = _account("admin", suffix, technical_now)
    enterprise_account = _account("enterprise", suffix, technical_now)
    eligible, eligible_site, eligible_location = _enterprise_site(
        suffix=f"eligible-{suffix}",
        lifecycle="active",
        classification="official",
        barangay="Barangay Uno",
        effective_from=effective_last_year,
        technical_created_at=technical_now,
    )
    unresolved, unresolved_site, unresolved_location = _enterprise_site(
        suffix=f"unresolved-{suffix}",
        lifecycle="active",
        classification="official",
        barangay=None,
        effective_from=effective_last_year,
        technical_created_at=technical_now,
    )
    inactive, inactive_site, inactive_location = _enterprise_site(
        suffix=f"inactive-{suffix}",
        lifecycle="inactive",
        classification="official",
        barangay="Barangay Dos",
        effective_from=effective_last_year,
        technical_created_at=technical_now,
    )
    exempted, exempted_site, exempted_location = _enterprise_site(
        suffix=f"exempted-{suffix}",
        lifecycle="active",
        classification="official",
        barangay="Barangay Tres",
        effective_from=effective_last_year,
        technical_created_at=technical_now,
    )
    simulation, simulation_site, simulation_location = _enterprise_site(
        suffix=f"simulation-{suffix}",
        lifecycle="active",
        classification="simulation",
        barangay="Barangay Sim",
        effective_from=effective_last_year,
        technical_created_at=technical_now,
    )
    simulation_run = SimulationRun(
        id=str(uuid4()),
        scenario="obligation-scope-test",
        seed=suffix,
        range_start=canonical.starts_at,
        range_end=canonical.ends_at,
        status="active",
    )
    simulation.simulation_run_id = simulation_run.id
    membership = EnterpriseMembership(
        id=str(uuid4()),
        enterprise_id=eligible.id,
        account_id=enterprise_account.id,
        classification="official",
        membership_role="owner",
        started_at=effective_last_year,
    )
    db.add_all(
        [
            period,
            other_period,
            staff,
            admin,
            enterprise_account,
            eligible,
            unresolved,
            inactive,
            exempted,
            simulation_run,
            simulation,
        ]
    )
    await db.flush()
    db.add_all(
        [
            eligible_site,
            unresolved_site,
            inactive_site,
            exempted_site,
            simulation_site,
            eligible_location,
            unresolved_location,
            inactive_location,
            exempted_location,
            simulation_location,
            membership,
        ]
    )
    await db.flush()

    freeze_command = ObligationFreezeCommand.model_validate(
        {
            "contractVersion": 2,
            "commandId": str(uuid4()),
            "resolutions": [
                {
                    "siteId": exempted_site.id,
                    "eligibilityStatus": "exempt",
                    "reason": "Documented seasonal closure",
                }
            ],
        }
    )
    frozen = await freeze_period_obligations(
        db,
        account=staff,
        reporting_period_id=uuid4_from(period.id),
        command=freeze_command,
        frozen_at=technical_now,
    )

    assert frozen.disposition == "created"
    assert frozen.resource.summary.totalFrozen == 4
    assert frozen.resource.summary.eligibleExpected == 1
    assert frozen.resource.summary.exempt == 1
    assert frozen.resource.summary.ineligible == 1
    assert frozen.resource.summary.unresolved == 1
    assert frozen.resource.summary.complete is False
    historical = next(
        item for item in frozen.resource.obligations if str(item.siteId) == eligible_site.id
    )
    # Regression: target Enterprise.created_at is technical migration time. The site's
    # effective range is the authoritative registration evidence for historical periods.
    assert historical.registrationEffectiveAt == effective_last_year
    assert all(item.classification == "official" for item in frozen.resource.obligations)

    exact_replay = await freeze_period_obligations(
        db,
        account=staff,
        reporting_period_id=uuid4_from(period.id),
        command=freeze_command,
        frozen_at=technical_now + timedelta(minutes=1),
    )
    assert exact_replay.disposition == "replayed"
    assert exact_replay.acknowledgedAt == frozen.acknowledgedAt
    with pytest.raises(ObligationConflict, match="already bound"):
        await freeze_period_obligations(
            db,
            account=staff,
            reporting_period_id=uuid4_from(other_period.id),
            command=freeze_command,
            frozen_at=technical_now + timedelta(minutes=1),
        )

    late_enterprise, late_site, late_location = _enterprise_site(
        suffix=f"late-{suffix}",
        lifecycle="active",
        classification="official",
        barangay="Barangay Late",
        effective_from=effective_last_year,
        technical_created_at=technical_now,
    )
    db.add(late_enterprise)
    await db.flush()
    db.add_all([late_site, late_location])
    await db.flush()
    rerun = await freeze_period_obligations(
        db,
        account=staff,
        reporting_period_id=uuid4_from(period.id),
        command=ObligationFreezeCommand.model_validate(
            {"contractVersion": 2, "commandId": str(uuid4()), "resolutions": []}
        ),
        frozen_at=technical_now + timedelta(minutes=2),
    )
    assert rerun.resource.summary.totalFrozen == 4
    assert all(str(item.siteId) != late_site.id for item in rerun.resource.obligations)

    reconciled = await freeze_period_obligations(
        db,
        account=staff,
        reporting_period_id=uuid4_from(period.id),
        command=ObligationFreezeCommand.model_validate(
            {
                "contractVersion": 2,
                "commandId": str(uuid4()),
                "resolutions": [
                    {
                        "siteId": unresolved_site.id,
                        "eligibilityStatus": "eligible",
                        "frozenBarangay": "Barangay Resolved",
                    }
                ],
            }
        ),
        frozen_at=technical_now + timedelta(minutes=3),
    )
    assert reconciled.disposition == "reconciled"
    assert reconciled.resource.summary.eligibleExpected == 2
    assert reconciled.resource.summary.unresolved == 0
    resolved = next(
        item for item in reconciled.resource.obligations if str(item.siteId) == unresolved_site.id
    )
    assert resolved.eligibilityBasis == "manual_resolution"
    assert resolved.frozenBarangay == "Barangay Resolved"
    assert resolved.acceptanceBlocked is False

    enterprise_view = await read_period_compliance(
        db,
        account=enterprise_account,
        reporting_period_id=uuid4_from(period.id),
    )
    admin_view = await read_period_compliance(
        db,
        account=admin,
        reporting_period_id=uuid4_from(period.id),
    )
    assert [str(item.enterpriseId) for item in enterprise_view.obligations] == [eligible.id]
    assert admin_view.summary.totalFrozen == 4

    for phase_time, expected_phase in (
        (canonical.starts_at - timedelta(days=1), "pre_window"),
        (canonical.starts_at, "current_period"),
        (canonical.ends_at, "overdue"),
    ):
        first = await create_reminder_intents(
            db,
            account=staff,
            reporting_period_id=uuid4_from(period.id),
            command=ReminderIntentCommand.model_validate(
                {"contractVersion": 2, "commandId": str(uuid4())}
            ),
            as_of=phase_time,
        )
        replay = await create_reminder_intents(
            db,
            account=staff,
            reporting_period_id=uuid4_from(period.id),
            command=ReminderIntentCommand.model_validate(
                {"contractVersion": 2, "commandId": str(uuid4())}
            ),
            as_of=phase_time + timedelta(minutes=1),
        )
        assert first.phase == expected_phase
        assert first.createdCount == 2
        assert first.skippedCount == 0
        assert replay.disposition == "replayed"
        assert replay.createdCount == 0
        assert replay.existingCount == 2
        assert replay.eventIds == first.eventIds

    assert (
        await db.scalar(
            select(func.count())
            .select_from(DomainEvent)
            .where(DomainEvent.event_type == "reporting_obligation.reminder_requested")
        )
        == 6
    )
    assert (
        await db.scalar(
            select(func.count())
            .select_from(DomainEventDelivery)
            .join(DomainEvent, DomainEvent.id == DomainEventDelivery.domain_event_id)
            .where(DomainEvent.event_type == "reporting_obligation.reminder_requested")
        )
        == 12
    )
    assert (
        await db.scalar(
            select(func.count())
            .select_from(DomainEventDelivery)
            .join(DomainEvent, DomainEvent.id == DomainEventDelivery.domain_event_id)
            .where(
                DomainEvent.event_type.in_(
                    (
                        "reporting_period.obligations_frozen",
                        "reporting_period.obligation_freeze_replayed",
                        "reporting_period.obligations_reconciled",
                    )
                )
            )
        )
        == 6
    )


@pytest.mark.asyncio
async def test_zero_obligation_period_is_frozen_and_cannot_expand_on_rerun(
    obligation_session: AsyncSession,
) -> None:
    db = obligation_session
    suffix = uuid4().hex
    now = datetime(2026, 7, 13, tzinfo=UTC)
    canonical = monthly_reporting_period(2024, 1)
    period = ReportingPeriod(
        id=str(uuid4()),
        natural_key=canonical.natural_key,
        cadence="month",
        timezone_name=canonical.timezone,
        local_start_date=canonical.local_start_date,
        local_end_date=canonical.local_end_date,
        starts_at=canonical.starts_at,
        ends_at=canonical.ends_at,
        submission_opens_at=canonical.submission_opens_at,
        submission_closes_at=canonical.submission_closes_at,
        status="closed",
        label="January 2024",
    )
    staff = _account("staff", suffix, now)
    db.add_all([period, staff])
    await db.flush()

    first = await freeze_period_obligations(
        db,
        account=staff,
        reporting_period_id=uuid4_from(period.id),
        command=ObligationFreezeCommand.model_validate(
            {"contractVersion": 2, "commandId": str(uuid4())}
        ),
        frozen_at=now,
    )
    assert first.resource.summary.totalFrozen == 0
    assert first.resource.summary.complete is True

    backdated_enterprise, backdated_site, backdated_location = _enterprise_site(
        suffix=f"backdated-{suffix}",
        lifecycle="active",
        classification="official",
        barangay="Barangay Backdated",
        effective_from=canonical.starts_at,
        technical_created_at=now,
    )
    db.add(backdated_enterprise)
    await db.flush()
    db.add_all([backdated_site, backdated_location])
    await db.flush()

    rerun = await freeze_period_obligations(
        db,
        account=staff,
        reporting_period_id=uuid4_from(period.id),
        command=ObligationFreezeCommand.model_validate(
            {"contractVersion": 2, "commandId": str(uuid4())}
        ),
        frozen_at=now + timedelta(minutes=1),
    )
    assert rerun.disposition == "replayed"
    assert rerun.resource.summary.totalFrozen == 0
    assert (
        await db.scalar(
            select(func.count())
            .select_from(ReportingObligation)
            .where(
                ReportingObligation.reporting_period_id == period.id,
                ReportingObligation.classification == "official",
            )
        )
        == 0
    )


@pytest.mark.asyncio
async def test_freeze_uses_period_effective_location_and_keeps_missing_evidence_visible(
    obligation_session: AsyncSession,
) -> None:
    db = obligation_session
    suffix = uuid4().hex
    frozen_at = datetime(2026, 7, 15, tzinfo=UTC)
    canonical = monthly_reporting_period(2025, 6)
    period = ReportingPeriod(
        id=str(uuid4()),
        natural_key=canonical.natural_key,
        cadence=canonical.cadence,
        timezone_name=canonical.timezone,
        local_start_date=canonical.local_start_date,
        local_end_date=canonical.local_end_date,
        starts_at=canonical.starts_at,
        ends_at=canonical.ends_at,
        submission_opens_at=canonical.submission_opens_at,
        submission_closes_at=canonical.submission_closes_at,
        status="closed",
        label=canonical.label,
    )
    staff = _account("staff", suffix, frozen_at)
    moved, moved_site, first_location = _enterprise_site(
        suffix=f"moved-{suffix}",
        lifecycle="active",
        classification="official",
        barangay="Barangay Period Start",
        effective_from=canonical.starts_at - timedelta(days=30),
        technical_created_at=frozen_at,
    )
    location_change_at = canonical.starts_at + timedelta(days=10)
    first_location.effective_to = location_change_at
    second_location = SiteLocationVersion(
        site_id=moved_site.id,
        classification="official",
        version=2,
        barangay="Barangay Later Address",
        timezone_name="Asia/Manila",
        building_capacity=120,
        effective_from=location_change_at,
        change_reason="address_changed",
        created_at=frozen_at,
    )
    missing, missing_site, _unused_location = _enterprise_site(
        suffix=f"missing-{suffix}",
        lifecycle="active",
        classification="official",
        barangay="Not persisted",
        effective_from=canonical.starts_at,
        technical_created_at=frozen_at,
    )
    db.add_all([period, staff, moved, missing])
    await db.flush()
    db.add_all([moved_site, missing_site, first_location, second_location])
    await db.flush()

    result = await freeze_period_obligations(
        db,
        account=staff,
        reporting_period_id=uuid4_from(period.id),
        command=ObligationFreezeCommand.model_validate(
            {"contractVersion": 2, "commandId": str(uuid4())}
        ),
        frozen_at=frozen_at,
    )

    moved_obligation = next(
        item for item in result.resource.obligations if item.siteId == UUID(moved_site.id)
    )
    assert moved_obligation.eligibilityStatus == "eligible"
    assert moved_obligation.frozenBarangay == "Barangay Period Start"
    assert moved_obligation.acceptanceBlocked is False
    missing_obligation = next(
        item for item in result.resource.obligations if item.siteId == UUID(missing_site.id)
    )
    assert missing_obligation.eligibilityStatus == "unknown"
    assert missing_obligation.eligibilityReason == (
        "unresolved_topology: missing effective location version"
    )
    assert missing_obligation.frozenBarangay is None
    assert missing_obligation.acceptanceBlocked is True
    assert result.resource.summary.totalFrozen == 2
    assert result.resource.summary.eligibleExpected == 1
    assert result.resource.summary.unresolved == 1
    assert result.resource.summary.complete is False


@pytest.mark.asyncio
async def test_freeze_preserves_legacy_obligations_and_adds_only_missing_registry_rows(
    obligation_session: AsyncSession,
) -> None:
    db = obligation_session
    suffix = uuid4().hex
    frozen_at = datetime(2026, 7, 13, tzinfo=UTC)
    canonical = monthly_reporting_period(2025, 8)
    period = ReportingPeriod(
        id=str(uuid4()),
        natural_key=canonical.natural_key,
        cadence=canonical.cadence,
        timezone_name=canonical.timezone,
        local_start_date=canonical.local_start_date,
        local_end_date=canonical.local_end_date,
        starts_at=canonical.starts_at,
        ends_at=canonical.ends_at,
        submission_opens_at=canonical.submission_opens_at,
        submission_closes_at=canonical.submission_closes_at,
        status="closed",
        label=canonical.label,
    )
    staff = _account("staff", suffix, frozen_at)
    legacy_enterprise, legacy_site, legacy_location = _enterprise_site(
        suffix=f"legacy-{suffix}",
        lifecycle="active",
        classification="official",
        barangay="Barangay Legacy",
        effective_from=canonical.starts_at,
        technical_created_at=frozen_at,
    )
    new_enterprise, new_site, new_location = _enterprise_site(
        suffix=f"new-{suffix}",
        lifecycle="active",
        classification="official",
        barangay="Barangay New",
        effective_from=canonical.starts_at,
        technical_created_at=frozen_at,
    )
    db.add_all([period, staff, legacy_enterprise, new_enterprise])
    await db.flush()
    db.add_all([legacy_site, new_site, legacy_location, new_location])
    await db.flush()
    legacy_obligation = ReportingObligation(
        id=str(uuid4()),
        reporting_period_id=period.id,
        enterprise_id=legacy_enterprise.id,
        site_id=legacy_site.id,
        classification="official",
        eligibility_status="unknown",
        eligibility_basis="migration_evidence",
        exemption_reason="Historical eligibility was not provable during migration.",
        frozen_barangay=legacy_location.barangay,
        enterprise_official_code=legacy_enterprise.official_code,
        enterprise_name=legacy_enterprise.name,
        site_code=legacy_site.site_code,
        site_name=legacy_site.name,
        timezone_name="Asia/Manila",
        registration_effective_at=legacy_location.effective_from,
        acceptance_blocked=True,
    )
    db.add(legacy_obligation)
    await db.flush()

    result = await freeze_period_obligations(
        db,
        account=staff,
        reporting_period_id=uuid4_from(period.id),
        command=ObligationFreezeCommand.model_validate(
            {"contractVersion": 2, "commandId": str(uuid4())}
        ),
        frozen_at=frozen_at,
    )

    assert result.disposition == "created"
    assert result.resource.frozenAt == frozen_at
    assert result.resource.summary.totalFrozen == 2
    assert result.resource.summary.unresolved == 1
    assert result.resource.summary.eligibleExpected == 1
    obligations = list(
        await db.scalars(
            select(ReportingObligation)
            .where(
                ReportingObligation.reporting_period_id == period.id,
                ReportingObligation.classification == "official",
            )
            .order_by(ReportingObligation.enterprise_id, ReportingObligation.site_id)
        )
    )
    assert len(obligations) == 2
    preserved = next(item for item in obligations if item.id == legacy_obligation.id)
    assert preserved.eligibility_status == "unknown"
    assert preserved.eligibility_basis == "migration_evidence"
    assert preserved.acceptance_blocked is True
    created = next(item for item in obligations if item.site_id == new_site.id)
    assert created.eligibility_status == "eligible"
    assert created.eligibility_basis == "registry_snapshot"
    assert created.acceptance_blocked is False

    marker = await db.scalar(
        select(DomainEvent).where(
            DomainEvent.event_key == f"reporting-period:{period.id}:official-obligations-frozen:v1"
        )
    )
    assert marker is not None
    marker_payload = json.loads(marker.payload_json)
    assert marker_payload["preservedObligationCount"] == 1
    assert marker_payload["createdObligationCount"] == 1
    assert set(marker_payload["obligationIds"]) == {item.id for item in obligations}


def _account(role: str, suffix: str, activated_at: datetime) -> Account:
    return Account(
        id=str(uuid4()),
        email=f"obligations-{role}-{uuid4().hex}@example.test",
        password_hash="not-used-by-obligation-tests",
        role=AccountRole(role),
        display_name=f"Obligation {role.title()} {suffix[:6]}",
        title=f"{role.title()} account",
        status=AccountStatus.ACTIVE,
        activated_at=activated_at,
    )


def _enterprise_site(
    *,
    suffix: str,
    lifecycle: str,
    classification: str,
    barangay: str | None,
    effective_from: datetime,
    technical_created_at: datetime,
) -> tuple[Enterprise, EnterpriseSite, SiteLocationVersion]:
    enterprise = Enterprise(
        id=str(uuid4()),
        official_code=f"OBL-{suffix}",
        name=f"Obligation Enterprise {suffix}",
        classification=classification,
        lifecycle_state=lifecycle,
        created_at=technical_created_at,
    )
    site = EnterpriseSite(
        id=str(uuid4()),
        enterprise_id=enterprise.id,
        classification=classification,
        site_code=f"SITE-{suffix}",
        name=f"Obligation Site {suffix}",
        registered_at=effective_from,
        created_at=technical_created_at,
    )
    location = SiteLocationVersion(
        site_id=site.id,
        classification=classification,
        version=1,
        barangay=barangay,
        timezone_name="Asia/Manila",
        building_capacity=100,
        effective_from=effective_from,
        change_reason="test_fixture",
        created_at=technical_created_at,
    )
    return enterprise, site, location


def uuid4_from(value: str) -> UUID:
    return UUID(value)
