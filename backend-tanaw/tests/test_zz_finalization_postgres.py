import asyncio
import os
from collections.abc import AsyncIterator, Sequence
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import Settings
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.activity_logs.models import ActivityLog
from app.features.events.models import DomainEvent, DomainEventDelivery
from app.features.final_reports.artifact_service import FinalReportArtifactProcessor
from app.features.final_reports.artifact_storage import LocalArtifactStorage
from app.features.final_reports.envelopes import FinalizeReportsCommand
from app.features.final_reports.models import (
    FinalReportArtifact,
    FinalReportCommandReceipt,
    FinalReportEvent,
    FinalReportItem,
    FinalReportMetricFact,
    FinalReportSourceClaim,
    FinalReportVersion,
    ReportFinalization,
)
from app.features.final_reports.service import (
    FinalizationConflict,
    FinalizationError,
    finalize_report_command,
)
from app.features.reporting.contracts import monthly_reporting_period
from app.features.reporting.models import (
    EnterpriseReport,
    ReportingObligation,
    ReportingPeriod,
    ReportMetricFact,
    ReportRevision,
)
from app.features.simulation.models import MockDataRun
from app.features.topology.models import Enterprise, EnterpriseSite

TEST_DATABASE_ENV = "TANAW_TEST_DATABASE_URL"

# Register the simulation-lineage target before SQLAlchemy sorts the topology
# mapper dependencies in this deliberately isolated PostgreSQL module.
assert MockDataRun.__tablename__ == "mock_data_runs"


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
async def finalization_session() -> AsyncIterator[AsyncSession]:
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
async def test_finalization_is_atomic_idempotent_and_exact(
    finalization_session: AsyncSession,
) -> None:
    staff, period, sources = await _seed_accepted_sources(
        finalization_session, barangays=["Poblacion", "Poblacion"]
    )
    command = _command(period.id, [source.id for source in sources])

    created = await finalize_report_command(
        finalization_session,
        account=staff,
        command=command,
        acknowledged_at=period.ends_at,
    )
    replayed = created
    for _ in range(100):
        replayed = await finalize_report_command(
            finalization_session,
            account=staff,
            command=command,
            acknowledged_at=period.ends_at,
        )

    assert created.disposition == "created"
    assert replayed.disposition == "replayed"
    assert replayed.resource.finalReportVersionId == created.resource.finalReportVersionId
    assert created.resource.scopeLabel == "Selected enterprises (2)"
    assert await _count(finalization_session, ReportFinalization) == 1
    assert await _count(finalization_session, FinalReportVersion) == 1
    assert await _count(finalization_session, FinalReportSourceClaim) == 2
    assert await _count(finalization_session, FinalReportItem) == 2
    assert await _count(finalization_session, FinalReportMetricFact) == 4
    assert await _count(finalization_session, FinalReportEvent) == 1
    assert await _count(finalization_session, FinalReportArtifact) == 1
    assert await _count(finalization_session, FinalReportCommandReceipt) == 1
    assert await _count(finalization_session, DomainEvent) == 1
    assert await _count(finalization_session, DomainEventDelivery) == 2
    old_activity = ActivityLog(
        id=str(uuid4()),
        timestamp=datetime(1900, 1, 1, tzinfo=UTC),
        category="Staff Operation",
        severity="Success",
        actor=staff.display_name,
        actor_role="LGU Staff",
        action="Legacy Duplicate Final Audit",
        target=str(created.resource.reportFinalizationId),
        summary="A convenience log must not own the official finalization audit.",
        source_id=str(created.resource.reportFinalizationId),
        source_kind="real",
    )
    finalization_session.add(old_activity)
    await finalization_session.flush([old_activity])
    await finalization_session.execute(
        delete(ActivityLog).where(
            ActivityLog.id == old_activity.id,
            ActivityLog.timestamp < datetime(1901, 1, 1, tzinfo=UTC),
        )
    )
    await finalization_session.flush()
    assert await finalization_session.get(ActivityLog, old_activity.id) is None
    assert await _count(finalization_session, FinalReportEvent) == 1
    for source in sources:
        report = await finalization_session.get(EnterpriseReport, source.enterprise_report_id)
        assert report is not None
        assert report.workflow_state == "consolidated"
        assert report.logical_version == 3

    conflict_payload = command.model_dump(mode="python")
    conflict_payload["payload"]["reason"] = "A different effect"
    with pytest.raises(FinalizationConflict, match="different payload hash"):
        await finalize_report_command(
            finalization_session,
            account=staff,
            command=FinalizeReportsCommand.model_validate(conflict_payload),
        )

    missing_command = _command(period.id, [str(uuid4())])
    before = await _count(finalization_session, ReportFinalization)
    with pytest.raises(FinalizationError, match="Every source revision must exist"):
        await finalize_report_command(finalization_session, account=staff, command=missing_command)
    assert await _count(finalization_session, ReportFinalization) == before

    other_finalization = _command(period.id, [sources[0].id])
    with pytest.raises(FinalizationConflict, match="another finalization"):
        await finalize_report_command(
            finalization_session, account=staff, command=other_finalization
        )


@pytest.mark.asyncio
async def test_pending_artifact_renders_from_the_persisted_immutable_graph(
    finalization_session: AsyncSession,
    tmp_path: Path,
) -> None:
    staff, period, sources = await _seed_accepted_sources(
        finalization_session, barangays=["Poblacion"]
    )
    created = await finalize_report_command(
        finalization_session,
        account=staff,
        command=_command(period.id, [sources[0].id]),
        acknowledged_at=period.ends_at,
    )
    artifact = await finalization_session.scalar(
        select(FinalReportArtifact).where(
            FinalReportArtifact.final_report_version_id
            == str(created.resource.finalReportVersionId)
        )
    )
    assert artifact is not None
    settings = Settings(
        final_report_artifact_storage_root=tmp_path,
        final_report_artifact_max_bytes=64 * 1024,
    )
    storage = LocalArtifactStorage(tmp_path, max_bytes=64 * 1024)
    processor = FinalReportArtifactProcessor(
        sessions=async_sessionmaker(),
        storage=storage,
        settings=settings,
    )

    await processor._generate_locked(finalization_session, artifact)
    await finalization_session.flush([artifact])

    assert artifact.status == "ready"
    assert artifact.storage_key is not None
    assert artifact.content_hash is not None
    stored = await storage.read(key=artifact.storage_key)
    assert stored.content_hash == artifact.content_hash
    assert stored.content.startswith(b"%PDF-1.4")
    assert (
        await finalization_session.scalar(
            select(func.count(FinalReportEvent.id)).where(
                FinalReportEvent.final_report_artifact_id == artifact.id,
                FinalReportEvent.event_type == "artifact_ready",
            )
        )
        == 1
    )
    artifact_domain_event = await finalization_session.scalar(
        select(DomainEvent).where(
            DomainEvent.event_type == "final_report.artifact_ready",
            DomainEvent.aggregate_id == str(created.resource.reportFinalizationId),
        )
    )
    assert artifact_domain_event is not None
    assert (
        await finalization_session.scalar(
            select(func.count(DomainEventDelivery.id)).where(
                DomainEventDelivery.domain_event_id == artifact_domain_event.id,
                DomainEventDelivery.destination == "realtime_broadcast",
            )
        )
        == 1
    )


@pytest.mark.asyncio
async def test_scope_completeness_and_exact_current_acceptance_are_enforced(
    finalization_session: AsyncSession,
) -> None:
    staff, period, sources = await _seed_accepted_sources(
        finalization_session, barangays=["Poblacion", "Poblacion", "San Jose"]
    )
    with pytest.raises(FinalizationError, match="does not exactly match"):
        await finalize_report_command(
            finalization_session,
            account=staff,
            command=_command(
                period.id,
                [source.id for source in sources[:2]],
                scope_type="citywide",
            ),
        )
    assert await _count(finalization_session, ReportFinalization) == 0
    for source in sources:
        report = await finalization_session.get(EnterpriseReport, source.enterprise_report_id)
        assert report is not None and report.workflow_state == "accepted"

    barangay = await finalize_report_command(
        finalization_session,
        account=staff,
        command=_command(
            period.id,
            [source.id for source in sources[:2]],
            scope_type="barangay",
            barangay="poblacion",
        ),
    )
    assert barangay.resource.scopeType == "barangay"
    assert barangay.resource.scopeLabel == "Poblacion"
    third_report = await finalization_session.get(EnterpriseReport, sources[2].enterprise_report_id)
    assert third_report is not None
    assert third_report.workflow_state == "accepted"

    stale_report = third_report
    stale_report.workflow_state = "returned"
    stale_report.accepted_revision_id = None
    stale_report.logical_version += 1
    await finalization_session.flush([stale_report])
    with pytest.raises(FinalizationConflict, match="exact accepted unconsolidated"):
        await finalize_report_command(
            finalization_session,
            account=staff,
            command=_command(period.id, [sources[2].id]),
        )


@pytest.mark.asyncio
async def test_correction_reuses_owned_sources_and_intentional_omission_stays_consumed(
    finalization_session: AsyncSession,
) -> None:
    staff, period, sources = await _seed_accepted_sources(
        finalization_session, barangays=["Poblacion", "Poblacion"]
    )
    original = await finalize_report_command(
        finalization_session,
        account=staff,
        command=_command(period.id, [source.id for source in sources]),
    )
    correction = _command(
        period.id,
        [sources[0].id],
        expected_version=1,
        target_finalization_id=str(original.resource.reportFinalizationId),
        reason="Remove a source that was included in error.",
    )
    corrected = await finalize_report_command(
        finalization_session, account=staff, command=correction
    )

    assert corrected.resource.logicalVersion == 2
    assert corrected.resource.sourceCount == 1
    versions = list(
        await finalization_session.scalars(
            select(FinalReportVersion).order_by(FinalReportVersion.version_number)
        )
    )
    assert [item.disposition for item in versions] == ["superseded", "current"]
    assert await _count(finalization_session, FinalReportSourceClaim) == 2
    omitted_report = await finalization_session.get(
        EnterpriseReport, sources[1].enterprise_report_id
    )
    assert omitted_report is not None
    assert omitted_report.workflow_state == "consolidated"
    assert omitted_report.logical_version == 3
    with pytest.raises(FinalizationConflict, match="another finalization"):
        await finalize_report_command(
            finalization_session,
            account=staff,
            command=_command(period.id, [sources[1].id]),
        )


@pytest.mark.asyncio
async def test_missing_required_final_metric_rejects_without_consuming_source(
    finalization_session: AsyncSession,
) -> None:
    staff, period, sources = await _seed_accepted_sources(
        finalization_session, barangays=["Poblacion"], omitted_metric="exits"
    )
    with pytest.raises(FinalizationError, match="every required final metric"):
        await finalize_report_command(
            finalization_session,
            account=staff,
            command=_command(period.id, [sources[0].id]),
        )
    report = await finalization_session.get(EnterpriseReport, sources[0].enterprise_report_id)
    assert report is not None and report.workflow_state == "accepted"
    assert await _count(finalization_session, FinalReportSourceClaim) == 0


@pytest.mark.asyncio
async def test_final_metric_aggregate_accepts_exact_numeric_20_6_upper_boundary(
    finalization_session: AsyncSession,
) -> None:
    staff, period, sources = await _seed_accepted_sources(
        finalization_session,
        barangays=["Boundary A", "Boundary B"],
        entries_values=[
            Decimal("50000000000000.000000"),
            Decimal("49999999999999.999999"),
        ],
    )

    created = await finalize_report_command(
        finalization_session,
        account=staff,
        command=_command(period.id, [source.id for source in sources]),
    )
    entries = await finalization_session.scalar(
        select(FinalReportMetricFact).where(
            FinalReportMetricFact.final_report_version_id
            == str(created.resource.finalReportVersionId),
            FinalReportMetricFact.definition == "entries",
        )
    )

    assert entries is not None
    assert entries.value == Decimal("99999999999999.999999")


@pytest.mark.asyncio
async def test_final_metric_aggregate_rejects_numeric_20_6_overflow_before_insert(
    finalization_session: AsyncSession,
) -> None:
    staff, period, sources = await _seed_accepted_sources(
        finalization_session,
        barangays=["Overflow A", "Overflow B"],
        entries_values=[
            Decimal("99999999999999.999999"),
            Decimal("0.000001"),
        ],
    )

    with pytest.raises(FinalizationError, match=r"Aggregated metric entries.*NUMERIC\(20,6\)"):
        await finalize_report_command(
            finalization_session,
            account=staff,
            command=_command(period.id, [source.id for source in sources]),
        )

    assert await _count(finalization_session, FinalReportVersion) == 0
    assert await _count(finalization_session, FinalReportSourceClaim) == 0
    for source in sources:
        report = await finalization_session.get(EnterpriseReport, source.enterprise_report_id)
        assert report is not None
        assert report.workflow_state == "accepted"


@pytest.mark.asyncio
async def test_concurrent_finalizations_cannot_claim_one_revision() -> None:
    raw_url = os.getenv(TEST_DATABASE_ENV)
    if not raw_url:
        pytest.skip(f"{TEST_DATABASE_ENV} is not configured.")
    engine = create_async_engine(_postgres_async_url(raw_url), pool_pre_ping=True)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as seed_session:
        staff, period, sources = await _seed_accepted_sources(
            seed_session, barangays=["Concurrency"]
        )
        await seed_session.commit()
    commands = [_command(period.id, [sources[0].id]) for _ in range(2)]

    async def run(command: FinalizeReportsCommand) -> object:
        async with session_factory() as session:
            try:
                acknowledgement = await finalize_report_command(
                    session, account=staff, command=command
                )
                await session.commit()
                return acknowledgement
            except Exception as exc:  # test captures the competing transaction outcome
                await session.rollback()
                return exc

    outcomes = await asyncio.gather(*(run(command) for command in commands))
    assert sum(not isinstance(item, Exception) for item in outcomes) == 1
    assert sum(isinstance(item, FinalizationConflict) for item in outcomes) == 1
    async with session_factory() as verification_session:
        claim_count = await verification_session.scalar(
            select(func.count())
            .select_from(FinalReportSourceClaim)
            .where(FinalReportSourceClaim.report_revision_id == sources[0].id)
        )
        assert claim_count == 1
    await engine.dispose()


async def _seed_accepted_sources(
    db: AsyncSession,
    *,
    barangays: Sequence[str],
    omitted_metric: str | None = None,
    entries_values: Sequence[Decimal] | None = None,
) -> tuple[Account, ReportingPeriod, list[ReportRevision]]:
    if entries_values is not None and len(entries_values) != len(barangays):
        raise ValueError("entries_values must match the number of seeded source revisions.")
    suffix = uuid4().hex
    now = datetime(2026, 1, 1, tzinfo=UTC)
    staff = Account(
        id=str(uuid4()),
        email=f"final-staff-{suffix}@example.test",
        password_hash="not-used-by-finalization-test",
        role=AccountRole.STAFF,
        display_name="Final Report Staff",
        title="Tourism Staff",
        status=AccountStatus.ACTIVE,
        activated_at=now,
    )
    submitter = Account(
        id=str(uuid4()),
        email=f"final-submitter-{suffix}@example.test",
        password_hash="not-used-by-finalization-test",
        role=AccountRole.ENTERPRISE,
        display_name="Final Report Submitter",
        title="Enterprise Manager",
        status=AccountStatus.ACTIVE,
        activated_at=now,
    )
    canonical = monthly_reporting_period(5000 + uuid4().int % 3000, 5)
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
        label=canonical.label,
    )
    db.add_all([staff, submitter, period])
    await db.flush([staff, submitter, period])
    revisions: list[ReportRevision] = []
    for index, barangay in enumerate(barangays):
        enterprise = Enterprise(
            id=str(uuid4()),
            official_code=f"FINAL-{suffix}-{index}",
            name=f"Finalization Enterprise {index}",
            classification="official",
            lifecycle_state="active",
        )
        site = EnterpriseSite(
            id=str(uuid4()),
            enterprise_id=enterprise.id,
            classification="official",
            site_code="PRIMARY",
            name=f"Finalization Site {index}",
            barangay=barangay,
            timezone_name="Asia/Manila",
            building_capacity=100,
            location_version=1,
            effective_from=now,
        )
        obligation = ReportingObligation(
            id=str(uuid4()),
            reporting_period_id=period.id,
            enterprise_id=enterprise.id,
            site_id=site.id,
            classification="official",
            eligibility_status="eligible",
            eligibility_basis="registry_snapshot",
            frozen_barangay=barangay,
            enterprise_official_code=enterprise.official_code,
            enterprise_name=enterprise.name,
            site_code=site.site_code,
            site_name=site.name,
            timezone_name="Asia/Manila",
            registration_effective_at=now,
            acceptance_blocked=False,
        )
        report_id = str(uuid4())
        revision_id = str(uuid4())
        report = EnterpriseReport(
            id=report_id,
            reporting_obligation_id=obligation.id,
            enterprise_id=enterprise.id,
            site_id=site.id,
            classification="official",
            workflow_state="accepted",
            current_revision_id=revision_id,
            accepted_revision_id=revision_id,
            logical_version=2,
            acceptance_blocked=False,
        )
        revision = ReportRevision(
            id=revision_id,
            enterprise_report_id=report_id,
            enterprise_id=enterprise.id,
            site_id=site.id,
            classification="official",
            revision_number=1,
            local_revision_id=f"local-{suffix}-{index}",
            idempotency_key=f"report:test:{suffix}-{index}",
            source_window_start=period.starts_at,
            source_window_end=period.ends_at,
            submitted_by_account_id=submitter.id,
            submitted_at=period.ends_at,
            received_at=period.ends_at,
            payload_hash="sha256:" + f"{index + 1:064x}",
            evidence_status="complete",
            acceptance_blocked=False,
            monitored_seconds=100,
            expected_seconds=100,
            coverage_gap_count=0,
            coverage_details_json="[]",
        )
        db.add(enterprise)
        await db.flush([enterprise])
        db.add(site)
        await db.flush([site])
        db.add(obligation)
        await db.flush([obligation])
        db.add_all([report, revision])
        await db.flush([report, revision])
        metric_specs = [
            (
                "entries",
                entries_values[index] if entries_values is not None else 10 + index,
                "events",
                "site",
                "confirmed",
            ),
            ("exits", 8 + index, "events", "site", "confirmed"),
            ("peak_occupancy", 5 + index, "people-estimate", "site", "confirmed"),
            (
                "unique_visitor_estimate",
                7 + index,
                "visitor-estimate",
                "site",
                "estimated",
            ),
        ]
        db.add_all(
            [
                ReportMetricFact(
                    id=str(uuid4()),
                    report_revision_id=revision.id,
                    classification="official",
                    definition=definition,
                    definition_version=1,
                    value=value,
                    unit=unit,
                    grain=grain,
                    window_start=period.starts_at,
                    window_end=period.ends_at,
                    timezone_name="Asia/Manila",
                    provenance="camera_derived",
                    quality=quality,
                    monitored_seconds=100,
                    expected_seconds=100,
                    coverage_gap_count=0,
                )
                for definition, value, unit, grain, quality in metric_specs
                if definition != omitted_metric
            ]
        )
        revisions.append(revision)
    await db.flush()
    return staff, period, revisions


def _command(
    period_id: str,
    revision_ids: Sequence[str],
    *,
    scope_type: str = "enterprise_selection",
    barangay: str | None = None,
    expected_version: int = 0,
    target_finalization_id: str | None = None,
    reason: str | None = None,
) -> FinalizeReportsCommand:
    command_id = uuid4()
    return FinalizeReportsCommand.model_validate(
        {
            "contractVersion": 2,
            "commandId": str(command_id),
            "idempotencyKey": f"final-report:test:{command_id}",
            "occurredAt": datetime.now(UTC),
            "expectedVersion": expected_version,
            "payload": {
                "targetFinalizationId": target_finalization_id,
                "reportingPeriodId": period_id,
                "scope": {"type": scope_type, "barangay": barangay},
                "reportRevisionIds": sorted(revision_ids),
                "reason": reason,
            },
        }
    )


async def _count(db: AsyncSession, model: type) -> int:
    value = await db.scalar(select(func.count()).select_from(model))
    assert isinstance(value, int)
    return value
