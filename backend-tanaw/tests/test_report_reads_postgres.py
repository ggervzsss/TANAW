import json
import os
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import event, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession, create_async_engine

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.final_reports.models import (
    FinalReportArtifact,
    FinalReportDemographicFact,
    FinalReportEvent,
    FinalReportItem,
    FinalReportMetricFact,
    FinalReportScopeMember,
    FinalReportSourceClaim,
    FinalReportVersion,
    ReportFinalization,
)
from app.features.final_reports.read_service import (
    FinalReportReadForbidden,
    FinalReportReadInvalidCursor,
    FinalReportReadNotFound,
    list_official_final_reports,
    read_official_final_report,
)
from app.features.reporting.contracts import monthly_reporting_period
from app.features.reporting.models import (
    EnterpriseReport,
    ReportDemographicFact,
    ReportingObligation,
    ReportingPeriod,
    ReportMetricFact,
    ReportReviewEvent,
    ReportRevision,
    ReportSourceBatch,
)
from app.features.reporting.read_service import (
    ReportReadForbidden,
    ReportReadInvalidCursor,
    ReportReadNotFound,
    list_official_enterprise_reports,
    list_owned_enterprise_reports,
    read_official_enterprise_report,
    read_owned_enterprise_report,
)
from app.features.simulation.models import SimulationRun
from app.features.topology.models import (
    Camera,
    EdgeDevice,
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
async def read_session() -> AsyncIterator[AsyncSession]:
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


@dataclass(frozen=True, slots=True)
class _SeededReport:
    report: EnterpriseReport
    obligation: ReportingObligation
    revisions: list[ReportRevision]
    enterprise: Enterprise
    site: EnterpriseSite


@pytest.mark.asyncio
async def test_report_read_integrity_schema_matches_postgres_catalog(
    read_session: AsyncSession,
) -> None:
    index_names = set(
        await read_session.scalars(
            text(
                "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() "
                "AND indexname IN ("
                "'ix_reporting_obligations_period_classification_id', "
                "'ix_enterprise_reports_queue_state_current', "
                "'ix_report_revisions_queue_received', "
                "'ix_report_source_batches_revision_order', "
                "'ix_final_report_versions_current_keyset', "
                "'ix_final_report_versions_current_scope_keyset', "
                "'ix_report_finalizations_period_current')"
            )
        )
    )
    assert index_names == {
        "ix_reporting_obligations_period_classification_id",
        "ix_enterprise_reports_queue_state_current",
        "ix_report_revisions_queue_received",
        "ix_report_source_batches_revision_order",
        "ix_final_report_versions_current_keyset",
        "ix_final_report_versions_current_scope_keyset",
        "ix_report_finalizations_period_current",
    }
    constraint_names = set(
        await read_session.scalars(
            text(
                "SELECT conname FROM pg_constraint WHERE conname IN ("
                "'ck_report_review_events_actor_snapshot', "
                "'ck_final_report_events_actor_snapshot', "
                "'ck_final_report_scope_members_identity_snapshots')"
            )
        )
    )
    assert constraint_names == {
        "ck_report_review_events_actor_snapshot",
        "ck_final_report_events_actor_snapshot",
        "ck_final_report_scope_members_identity_snapshots",
    }


@pytest.mark.asyncio
async def test_report_list_queries_use_target_keyset_indexes(
    read_session: AsyncSession,
) -> None:
    await read_session.execute(text("SET LOCAL enable_seqscan = off"))
    report_plan = await read_session.scalar(
        text(
            """
            EXPLAIN (FORMAT JSON)
            SELECT enterprise_reports.id, current_revision.received_at
            FROM report_revisions AS current_revision
            JOIN enterprise_reports
              ON enterprise_reports.current_revision_id = current_revision.id
             AND enterprise_reports.classification = current_revision.classification
            JOIN reporting_obligations
              ON reporting_obligations.id = enterprise_reports.reporting_obligation_id
            WHERE current_revision.classification = 'official'
              AND enterprise_reports.classification = 'official'
              AND reporting_obligations.classification = 'official'
            ORDER BY current_revision.received_at, enterprise_reports.id
            LIMIT 101
            """
        )
    )
    final_report_plan = await read_session.scalar(
        text(
            """
            EXPLAIN (FORMAT JSON)
            SELECT report_finalizations.id, current_version.finalized_at
            FROM final_report_versions AS current_version
            JOIN report_finalizations
              ON report_finalizations.current_version_id = current_version.id
             AND report_finalizations.classification = current_version.classification
            WHERE current_version.classification = 'official'
              AND current_version.disposition = 'current'
              AND report_finalizations.classification = 'official'
            ORDER BY current_version.finalized_at DESC, report_finalizations.id DESC
            LIMIT 101
            """
        )
    )

    rendered_report_plan = json.dumps(report_plan)
    assert "ix_report_revisions_queue_received" in rendered_report_plan
    assert '"Node Type": "Seq Scan"' not in rendered_report_plan
    rendered_final_report_plan = json.dumps(final_report_plan)
    assert "ix_final_report_versions_current_keyset" in rendered_final_report_plan
    assert "ix_report_finalizations_period_current" in rendered_final_report_plan
    assert '"Node Type": "Seq Scan"' not in rendered_final_report_plan


@pytest.mark.asyncio
async def test_report_reads_are_staff_only_paginated_exact_and_official(
    read_session: AsyncSession,
) -> None:
    staff, enterprise_account, period = await _seed_accounts_and_period(read_session)
    started_at = period.ends_at + timedelta(hours=1)
    detailed = await _seed_report(
        read_session,
        period=period,
        submitter=enterprise_account,
        classification="official",
        ordinal=1,
        updated_at=started_at,
        revision_count=2,
        accepted=True,
    )
    second = await _seed_report(
        read_session,
        period=period,
        submitter=enterprise_account,
        classification="official",
        ordinal=2,
        updated_at=started_at + timedelta(minutes=1),
    )
    third = await _seed_report(
        read_session,
        period=period,
        submitter=enterprise_account,
        classification="official",
        ordinal=3,
        updated_at=started_at + timedelta(minutes=2),
    )
    simulation = await _seed_report(
        read_session,
        period=period,
        submitter=enterprise_account,
        classification="simulation",
        ordinal=4,
        updated_at=started_at - timedelta(minutes=1),
    )
    await read_session.flush()

    with pytest.raises(ReportReadForbidden, match="Only an authenticated Staff"):
        await list_official_enterprise_reports(
            read_session,
            account=enterprise_account,
            limit=2,
            cursor=None,
            reporting_period_id=UUID(period.id),
        )

    with _captured_statements(read_session) as list_statements:
        first_page = await list_official_enterprise_reports(
            read_session,
            account=staff,
            limit=2,
            cursor=None,
            reporting_period_id=UUID(period.id),
        )
    assert len(list_statements) <= 2
    assert [str(item.enterpriseReportId) for item in first_page.items] == sorted(
        [second.report.id, third.report.id]
    )
    assert first_page.page.returnedCount == 2
    assert first_page.page.hasMore is True
    assert first_page.page.nextCursor is not None
    assert all(item.classification == "official" for item in first_page.items)
    assert simulation.report.id not in {str(item.enterpriseReportId) for item in first_page.items}

    second_page = await list_official_enterprise_reports(
        read_session,
        account=staff,
        limit=2,
        cursor=first_page.page.nextCursor,
        reporting_period_id=UUID(period.id),
    )
    assert [str(item.enterpriseReportId) for item in second_page.items] == [detailed.report.id]
    assert second_page.page.hasMore is False
    assert second_page.page.nextCursor is None
    with pytest.raises(ReportReadInvalidCursor, match="does not match"):
        await list_official_enterprise_reports(
            read_session,
            account=staff,
            limit=2,
            cursor=first_page.page.nextCursor,
            reporting_period_id=UUID(period.id),
            workflow_state="submitted",
        )

    original_staff_name = staff.display_name
    staff.display_name = "Renamed Staff Account"
    await read_session.flush([staff])
    with _captured_statements(read_session) as detail_statements:
        detail = await read_official_enterprise_report(
            read_session,
            account=staff,
            enterprise_report_id=UUID(detailed.report.id),
        )
    assert len(detail_statements) <= 6
    assert detail.workflowState == "accepted"
    assert detail.logicalVersion == 4
    assert detail.includedInOfficialTotals is True
    assert detail.currentRevisionId == detail.acceptedRevisionId
    assert len(detail.revisions) == 2
    assert detail.revisions[0].isCurrent is False
    assert detail.revisions[0].isAccepted is False
    assert detail.revisions[1].isCurrent is True
    assert detail.revisions[1].isAccepted is True
    assert detail.revisions[1].coverage.monitoredSeconds == 90
    assert detail.revisions[1].coverage.expectedSeconds == 100
    assert detail.revisions[1].coverage.coverageRatio == 0.9
    assert detail.revisions[1].coverage.gaps[0].reason == "stream_unavailable"
    assert detail.revisions[1].metrics[0].provenance == "camera_derived"
    assert detail.revisions[1].metrics[0].quality == "degraded"
    assert detail.revisions[1].metrics[0].value == Decimal("0.100000")
    assert '"value":"0.100000"' in detail.model_dump_json()
    assert detail.revisions[1].demographics[0].provenance == "operator_entered"
    assert detail.revisions[1].sourceBatches[0].eventSequenceEndExclusive == 110
    assert [event.eventType for event in detail.reviewEvents] == [
        "revision_submitted",
        "returned",
        "revision_submitted",
        "accepted",
    ]
    assert detail.reviewEvents[-1].actor.displayName == original_staff_name

    with pytest.raises(ReportReadNotFound):
        await read_official_enterprise_report(
            read_session,
            account=staff,
            enterprise_report_id=uuid4(),
        )
    with pytest.raises(ReportReadNotFound):
        await read_official_enterprise_report(
            read_session,
            account=staff,
            enterprise_report_id=UUID(simulation.report.id),
        )


@pytest.mark.asyncio
async def test_enterprise_report_history_is_derived_from_effective_membership(
    read_session: AsyncSession,
) -> None:
    _staff, enterprise_account, period = await _seed_accounts_and_period(read_session)
    owned = await _seed_report(
        read_session,
        period=period,
        submitter=enterprise_account,
        classification="official",
        ordinal=20,
        updated_at=period.ends_at,
        revision_count=2,
        accepted=True,
    )
    unrelated = await _seed_report(
        read_session,
        period=period,
        submitter=enterprise_account,
        classification="official",
        ordinal=21,
        updated_at=period.ends_at + timedelta(minutes=1),
    )
    read_session.add(
        EnterpriseMembership(
            id=str(uuid4()),
            account_id=enterprise_account.id,
            enterprise_id=owned.enterprise.id,
            classification="official",
            membership_role="owner",
            started_at=period.starts_at,
        )
    )
    await read_session.flush()

    page = await list_owned_enterprise_reports(
        read_session,
        account=enterprise_account,
        limit=100,
        cursor=None,
        evaluated_at=period.ends_at,
    )

    assert [str(item.enterpriseReportId) for item in page.items] == [owned.report.id]
    assert page.items[0].currentRevision.localRevisionId == owned.revisions[-1].local_revision_id
    detail = await read_owned_enterprise_report(
        read_session,
        account=enterprise_account,
        enterprise_report_id=UUID(owned.report.id),
        evaluated_at=period.ends_at,
    )
    assert detail.enterprise.enterpriseId == UUID(owned.enterprise.id)
    assert detail.revisions[-1].localRevisionId == owned.revisions[-1].local_revision_id

    with pytest.raises(ReportReadNotFound):
        await read_owned_enterprise_report(
            read_session,
            account=enterprise_account,
            enterprise_report_id=UUID(unrelated.report.id),
            evaluated_at=period.ends_at,
        )


@pytest.mark.asyncio
async def test_final_report_reads_preserve_corrections_and_exact_selected_version(
    read_session: AsyncSession,
) -> None:
    staff, enterprise_account, period = await _seed_accounts_and_period(read_session)
    source = await _seed_report(
        read_session,
        period=period,
        submitter=enterprise_account,
        classification="official",
        ordinal=10,
        updated_at=period.ends_at + timedelta(hours=1),
        revision_count=2,
        accepted=True,
    )
    finalized_at = period.ends_at + timedelta(days=1)
    detailed_finalization, versions = await _seed_corrected_finalization(
        read_session,
        staff=staff,
        period=period,
        source=source,
        finalized_at=finalized_at,
    )
    newer = await _seed_finalization_summary(
        read_session,
        staff=staff,
        period=period,
        classification="official",
        ordinal=2,
        finalized_at=finalized_at + timedelta(minutes=3),
    )
    newest = await _seed_finalization_summary(
        read_session,
        staff=staff,
        period=period,
        classification="official",
        ordinal=3,
        finalized_at=finalized_at + timedelta(minutes=3),
    )
    simulation = await _seed_finalization_summary(
        read_session,
        staff=staff,
        period=period,
        classification="simulation",
        ordinal=4,
        finalized_at=finalized_at + timedelta(minutes=4),
    )
    await read_session.flush()

    original_identity = (
        source.enterprise.official_code,
        source.enterprise.name,
        source.enterprise.category,
        source.site.site_code,
        source.site.name,
        staff.display_name,
    )
    source.enterprise.official_code = f"RENAMED-{uuid4().hex}"
    source.enterprise.name = "Renamed mutable enterprise"
    source.enterprise.category = "Renamed category"
    source.site.site_code = "RENAMED-SITE"
    source.site.name = "Renamed mutable site"
    staff.display_name = "Renamed final-report Staff"
    await read_session.flush([source.enterprise, source.site, staff])

    with pytest.raises(FinalReportReadForbidden):
        await list_official_final_reports(
            read_session,
            account=enterprise_account,
            limit=2,
            cursor=None,
            reporting_period_id=UUID(period.id),
        )

    with _captured_statements(read_session) as list_statements:
        first_page = await list_official_final_reports(
            read_session,
            account=staff,
            limit=2,
            cursor=None,
            reporting_period_id=UUID(period.id),
        )
    assert len(list_statements) <= 2
    assert [str(item.reportFinalizationId) for item in first_page.items] == sorted(
        [newest.id, newer.id], reverse=True
    )
    assert simulation.id not in {str(item.reportFinalizationId) for item in first_page.items}
    assert first_page.page.hasMore is True
    assert first_page.page.nextCursor is not None
    second_page = await list_official_final_reports(
        read_session,
        account=staff,
        limit=2,
        cursor=first_page.page.nextCursor,
        reporting_period_id=UUID(period.id),
    )
    assert [str(item.reportFinalizationId) for item in second_page.items] == [
        detailed_finalization.id
    ]
    with pytest.raises(FinalReportReadInvalidCursor):
        await list_official_final_reports(
            read_session,
            account=staff,
            limit=2,
            cursor=first_page.page.nextCursor,
            reporting_period_id=UUID(period.id),
            scope_type="barangay",
        )

    with _captured_statements(read_session) as detail_statements:
        current = await read_official_final_report(
            read_session,
            account=staff,
            report_finalization_id=UUID(detailed_finalization.id),
        )
    assert len(detail_statements) <= 8
    assert current.logicalVersion == 2
    assert current.selectedVersionId == UUID(versions[1].id)
    assert current.selectedVersionIsCurrent is True
    assert [version.disposition for version in current.versions] == ["superseded", "current"]
    assert current.selectedVersion.contentHash == versions[1].content_hash
    assert current.selectedVersion.metrics[0].value == Decimal("0.100000")
    assert current.selectedVersion.demographics[0].count == 12
    assert current.selectedVersion.demographics[0].percentage == Decimal("0.1000")
    serialized = current.model_dump_json()
    assert '"value":"0.100000"' in serialized
    assert '"percentage":"0.1000"' in serialized
    assert current.selectedVersion.items[0].reportRevisionId == UUID(source.revisions[1].id)
    assert current.selectedVersion.scopeMembers[0].frozenBarangay == "Poblacion"
    member = current.selectedVersion.scopeMembers[0]
    assert (
        member.enterpriseOfficialCode,
        member.enterpriseName,
        member.enterpriseCategory,
        member.siteCode,
        member.siteName,
    ) == original_identity[:5]
    assert current.selectedVersion.artifacts[0].status == "ready"
    assert current.selectedVersion.artifacts[0].downloadAvailable is True
    assert current.selectedVersion.artifacts[0].contentHash == "sha256:" + "9" * 64
    assert [event.resultingVersion for event in current.events] == [1, 2]
    assert current.events[-1].actorDisplayName == original_identity[5]

    historical = await read_official_final_report(
        read_session,
        account=staff,
        report_finalization_id=UUID(detailed_finalization.id),
        version_id=UUID(versions[0].id),
    )
    assert historical.selectedVersionId == UUID(versions[0].id)
    assert historical.selectedVersionIsCurrent is False
    assert historical.currentVersionId == UUID(versions[1].id)
    assert historical.selectedVersion.metrics[0].value == Decimal("10.000000")
    assert historical.selectedVersion.items[0].reportRevisionId == UUID(source.revisions[0].id)
    assert historical.selectedVersion.artifacts[0].status == "pending"
    assert historical.selectedVersion.artifacts[0].contentHash is None

    with pytest.raises(FinalReportReadNotFound, match="version does not belong"):
        await read_official_final_report(
            read_session,
            account=staff,
            report_finalization_id=UUID(detailed_finalization.id),
            version_id=uuid4(),
        )
    with pytest.raises(FinalReportReadNotFound):
        await read_official_final_report(
            read_session,
            account=staff,
            report_finalization_id=UUID(simulation.id),
        )


async def _seed_accounts_and_period(
    db: AsyncSession,
) -> tuple[Account, Account, ReportingPeriod]:
    suffix = uuid4().hex
    now = datetime(2026, 1, 1, tzinfo=UTC)
    staff = Account(
        id=str(uuid4()),
        email=f"read-staff-{suffix}@example.test",
        password_hash="not-used",
        role=AccountRole.STAFF,
        display_name="Immutable Report Staff",
        title="Tourism Staff",
        status=AccountStatus.ACTIVE,
        activated_at=now,
    )
    enterprise_account = Account(
        id=str(uuid4()),
        email=f"read-enterprise-{suffix}@example.test",
        password_hash="not-used",
        role=AccountRole.ENTERPRISE,
        display_name="Report Submitter",
        title="Enterprise Manager",
        status=AccountStatus.ACTIVE,
        activated_at=now,
    )
    canonical = monthly_reporting_period(5000 + uuid4().int % 3000, 3)
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
        status="open",
        label=canonical.label,
    )
    db.add_all([staff, enterprise_account, period])
    await db.flush([staff, enterprise_account, period])
    return staff, enterprise_account, period


async def _seed_report(
    db: AsyncSession,
    *,
    period: ReportingPeriod,
    submitter: Account,
    classification: str,
    ordinal: int,
    updated_at: datetime,
    revision_count: int = 1,
    accepted: bool = False,
) -> _SeededReport:
    suffix = uuid4().hex
    enterprise = Enterprise(
        id=str(uuid4()),
        official_code=f"READ-{classification}-{suffix}",
        name=f"Read Enterprise {ordinal}",
        category=None,
        classification=classification,
        lifecycle_state="active",
    )
    simulation_run = (
        SimulationRun(
            id=str(uuid4()),
            scenario="report-read-scope-test",
            seed=suffix,
            range_start=period.starts_at,
            range_end=period.ends_at,
            status="active",
        )
        if classification == "simulation"
        else None
    )
    enterprise.simulation_run_id = simulation_run.id if simulation_run is not None else None
    site = EnterpriseSite(
        id=str(uuid4()),
        enterprise_id=enterprise.id,
        classification=classification,
        site_code="PRIMARY",
        name=f"Read Site {ordinal}",
        registered_at=period.starts_at,
    )
    location = SiteLocationVersion(
        id=str(uuid4()),
        site_id=site.id,
        classification=classification,
        version=1,
        barangay="Poblacion",
        timezone_name="Asia/Manila",
        building_capacity=100,
        effective_from=period.starts_at,
        change_reason="test_fixture",
    )
    device = EdgeDevice(
        id=str(uuid4()),
        site_id=site.id,
        classification=classification,
        device_key=f"read-device-{suffix}",
        display_name=f"Read Device {ordinal}",
        lifecycle_state="active",
        counter_epoch=str(uuid4()),
        credential_version=1,
    )
    camera = Camera(
        id=str(uuid4()),
        site_id=site.id,
        edge_device_id=device.id,
        classification=classification,
        camera_key="primary",
        display_name=f"Read Camera {ordinal}",
        lifecycle_state="active",
    )
    obligation = ReportingObligation(
        id=str(uuid4()),
        reporting_period_id=period.id,
        enterprise_id=enterprise.id,
        site_id=site.id,
        classification=classification,
        eligibility_status="eligible",
        eligibility_basis="registry_snapshot",
        frozen_barangay="Poblacion",
        enterprise_official_code=enterprise.official_code,
        enterprise_name=enterprise.name,
        site_code=site.site_code,
        site_name=site.name,
        timezone_name="Asia/Manila",
        registration_effective_at=period.starts_at,
        acceptance_blocked=False,
    )
    report_id = str(uuid4())
    revision_ids = [str(uuid4()) for _ in range(revision_count)]
    report = EnterpriseReport(
        id=report_id,
        reporting_obligation_id=obligation.id,
        enterprise_id=enterprise.id,
        site_id=site.id,
        classification=classification,
        workflow_state="accepted" if accepted else "submitted",
        current_revision_id=revision_ids[-1],
        accepted_revision_id=revision_ids[-1] if accepted else None,
        logical_version=4 if accepted else 1,
        acceptance_blocked=False,
        created_at=updated_at,
        updated_at=updated_at,
    )
    if simulation_run is not None:
        db.add(simulation_run)
        await db.flush([simulation_run])
    db.add(enterprise)
    await db.flush([enterprise])
    db.add_all([site, location])
    await db.flush([site])
    db.add(device)
    await db.flush([device])
    db.add(camera)
    await db.flush([camera])
    db.add(obligation)
    await db.flush([obligation])

    revisions = [
        ReportRevision(
            id=revision_id,
            enterprise_report_id=report.id,
            enterprise_id=enterprise.id,
            site_id=site.id,
            classification=classification,
            revision_number=index + 1,
            local_revision_id=f"local-{suffix}-{index + 1}",
            idempotency_key=f"report:test:{suffix}-{index + 1}",
            source_window_start=period.starts_at,
            source_window_end=period.ends_at,
            submitted_by_account_id=submitter.id,
            submitted_at=period.ends_at + timedelta(minutes=index),
            received_at=period.ends_at + timedelta(minutes=index, seconds=1),
            payload_hash="sha256:" + f"{ordinal * 10 + index:064x}",
            evidence_status="complete",
            acceptance_blocked=False,
            monitored_seconds=90,
            expected_seconds=100,
            coverage_gap_count=1,
            coverage_details_json=('[{"durationSeconds":10,"reason":"stream_unavailable"}]'),
            notes=None if index == 0 else "Corrected evidence.",
        )
        for index, revision_id in enumerate(revision_ids)
    ]
    db.add_all([report, *revisions])
    await db.flush([report, *revisions])
    for index, revision in enumerate(revisions):
        db.add(
            ReportMetricFact(
                id=str(uuid4()),
                report_revision_id=revision.id,
                classification=classification,
                definition="visitor_entries",
                definition_version=1,
                value=(
                    Decimal("0.100000")
                    if ordinal in {1, 10} and index == revision_count - 1
                    else Decimal(10 + index)
                ),
                unit="crossings",
                grain="site",
                window_start=period.starts_at,
                window_end=period.ends_at,
                timezone_name="Asia/Manila",
                provenance="camera_derived",
                quality="degraded",
                monitored_seconds=90,
                expected_seconds=100,
                coverage_gap_count=1,
            )
        )
        db.add(
            ReportDemographicFact(
                id=str(uuid4()),
                report_revision_id=revision.id,
                classification=classification,
                dimension="residence",
                value="local",
                count=8 + index,
                percentage=None,
                provenance="operator_entered",
                quality="confirmed",
            )
        )
        db.add(
            ReportSourceBatch(
                id=str(uuid4()),
                report_revision_id=revision.id,
                site_id=site.id,
                camera_id=camera.id,
                classification=classification,
                event_count=10,
                event_sequence_start=100,
                event_sequence_end_exclusive=110,
                aggregate_hash="sha256:" + f"{ordinal * 100 + index:064x}",
            )
        )
    if accepted:
        event_specs = [
            (revisions[0], "revision_submitted", None, "submitted", 0, 1, submitter),
            (revisions[0], "returned", "submitted", "returned", 1, 2, None),
            (revisions[-1], "revision_submitted", "returned", "submitted", 2, 3, submitter),
            (revisions[-1], "accepted", "submitted", "accepted", 3, 4, None),
        ]
        for index, (
            revision,
            event_type,
            from_state,
            to_state,
            expected,
            resulting,
            actor,
        ) in enumerate(event_specs):
            effective_actor = actor or _staff_account_from_session(db)
            db.add(
                ReportReviewEvent(
                    id=str(uuid4()),
                    enterprise_report_id=report.id,
                    report_revision_id=revision.id,
                    enterprise_id=enterprise.id,
                    classification=classification,
                    event_type=event_type,
                    from_state=from_state,
                    to_state=to_state,
                    actor_account_id=effective_actor.id,
                    actor_display_name=effective_actor.display_name,
                    actor_role=effective_actor.role.value,
                    reason="Reviewed evidence." if event_type != "revision_submitted" else None,
                    command_id=str(uuid4()),
                    expected_version=expected,
                    resulting_version=resulting,
                    occurred_at=period.ends_at + timedelta(minutes=index),
                )
            )
    else:
        db.add(
            ReportReviewEvent(
                id=str(uuid4()),
                enterprise_report_id=report.id,
                report_revision_id=revisions[0].id,
                enterprise_id=enterprise.id,
                classification=classification,
                event_type="revision_submitted",
                from_state=None,
                to_state="submitted",
                actor_account_id=submitter.id,
                actor_display_name=submitter.display_name,
                actor_role=submitter.role.value,
                reason=None,
                command_id=str(uuid4()),
                expected_version=0,
                resulting_version=1,
                occurred_at=period.ends_at,
            )
        )
    await db.flush()
    return _SeededReport(
        report=report,
        obligation=obligation,
        revisions=revisions,
        enterprise=enterprise,
        site=site,
    )


def _staff_account_from_session(db: AsyncSession) -> Account:
    for instance in db.identity_map.values():
        if isinstance(instance, Account) and instance.role == AccountRole.STAFF:
            return instance
    raise RuntimeError("The read test Staff account was not seeded.")


async def _seed_corrected_finalization(
    db: AsyncSession,
    *,
    staff: Account,
    period: ReportingPeriod,
    source: _SeededReport,
    finalized_at: datetime,
) -> tuple[ReportFinalization, list[FinalReportVersion]]:
    finalization_id = str(uuid4())
    version_ids = [str(uuid4()), str(uuid4())]
    finalization = ReportFinalization(
        id=finalization_id,
        reporting_period_id=period.id,
        classification="official",
        report_code=f"FR-READ-{uuid4().hex}",
        current_version_id=version_ids[1],
        logical_version=2,
        created_by_account_id=staff.id,
        created_at=finalized_at,
        updated_at=finalized_at + timedelta(minutes=1),
    )
    versions = [
        FinalReportVersion(
            id=version_id,
            report_finalization_id=finalization.id,
            classification="official",
            version_number=index + 1,
            disposition="superseded" if index == 0 else "current",
            scope_type="enterprise_selection",
            scope_barangay=None,
            scope_label="Selected enterprises (1)",
            source_count=1,
            scope_member_count=1,
            content_hash="sha256:" + str(index + 1) * 64,
            prepared_by_account_id=staff.id,
            prepared_by_name=staff.display_name,
            prepared_by_role=staff.role.value,
            finalized_at=finalized_at + timedelta(minutes=index),
            created_at=finalized_at + timedelta(minutes=index),
        )
        for index, version_id in enumerate(version_ids)
    ]
    db.add_all([finalization, *versions])
    await db.flush([finalization, *versions])
    for revision in source.revisions:
        db.add(
            FinalReportSourceClaim(
                id=str(uuid4()),
                report_finalization_id=finalization.id,
                report_revision_id=revision.id,
                classification="official",
                claimed_at=finalized_at,
            )
        )
    await db.flush()
    for index, version in enumerate(versions):
        scope_member = FinalReportScopeMember(
            id=str(uuid4()),
            final_report_version_id=version.id,
            report_finalization_id=finalization.id,
            reporting_obligation_id=source.obligation.id,
            enterprise_id=source.obligation.enterprise_id,
            site_id=source.obligation.site_id,
            classification="official",
            enterprise_official_code=source.enterprise.official_code,
            enterprise_name=source.enterprise.name,
            enterprise_category=source.enterprise.category,
            site_code=source.site.site_code,
            site_name=source.site.name,
            frozen_barangay="Poblacion",
        )
        db.add(scope_member)
        await db.flush([scope_member])
        db.add(
            FinalReportItem(
                id=str(uuid4()),
                final_report_version_id=version.id,
                report_finalization_id=finalization.id,
                reporting_obligation_id=source.obligation.id,
                report_revision_id=source.revisions[index].id,
                classification="official",
                source_payload_hash=source.revisions[index].payload_hash,
            )
        )
        db.add(
            FinalReportMetricFact(
                id=str(uuid4()),
                final_report_version_id=version.id,
                classification="official",
                definition="entries",
                definition_version=1,
                value=Decimal("10.000000") if index == 0 else Decimal("0.100000"),
                unit="events",
                aggregation_method="sum",
                quality="confirmed",
                source_fact_count=1,
            )
        )
        db.add(
            FinalReportDemographicFact(
                id=str(uuid4()),
                final_report_version_id=version.id,
                classification="official",
                dimension="residence",
                value="local",
                count=11 + index,
                percentage=Decimal("0.1000") if index == 1 else Decimal("100.0000"),
                quality="confirmed",
                source_fact_count=1,
            )
        )
        db.add(
            FinalReportEvent(
                id=str(uuid4()),
                report_finalization_id=finalization.id,
                final_report_version_id=version.id,
                classification="official",
                event_type="version_finalized",
                actor_account_id=staff.id,
                actor_display_name=staff.display_name,
                actor_role=staff.role.value,
                command_id=str(uuid4()),
                expected_version=index,
                resulting_version=index + 1,
                reason=None if index == 0 else "Corrected source facts.",
                occurred_at=finalized_at + timedelta(minutes=index),
            )
        )
    db.add(
        FinalReportArtifact(
            id=str(uuid4()),
            final_report_version_id=versions[0].id,
            classification="official",
            status="pending",
            template_version="official-final-report-v1",
            mime_type="application/pdf",
            generation_attempts=0,
            created_at=finalized_at,
            updated_at=finalized_at,
        )
    )
    db.add(
        FinalReportArtifact(
            id=str(uuid4()),
            final_report_version_id=versions[1].id,
            classification="official",
            status="ready",
            template_version="official-final-report-v1",
            mime_type="application/pdf",
            storage_key=f"official-final/{versions[1].id}.pdf",
            content_hash="sha256:" + "9" * 64,
            generation_attempts=1,
            generated_at=finalized_at + timedelta(minutes=2),
            generated_by_account_id=staff.id,
            created_at=finalized_at + timedelta(minutes=1),
            updated_at=finalized_at + timedelta(minutes=2),
        )
    )
    await db.flush()
    return finalization, versions


async def _seed_finalization_summary(
    db: AsyncSession,
    *,
    staff: Account,
    period: ReportingPeriod,
    classification: str,
    ordinal: int,
    finalized_at: datetime,
) -> ReportFinalization:
    finalization_id = str(uuid4())
    version_id = str(uuid4())
    finalization = ReportFinalization(
        id=finalization_id,
        reporting_period_id=period.id,
        classification=classification,
        report_code=f"FR-SUMMARY-{classification}-{uuid4().hex}",
        current_version_id=version_id,
        logical_version=1,
        created_by_account_id=staff.id,
        created_at=finalized_at,
        updated_at=finalized_at,
    )
    version = FinalReportVersion(
        id=version_id,
        report_finalization_id=finalization.id,
        classification=classification,
        version_number=1,
        disposition="current",
        scope_type="enterprise_selection",
        scope_barangay=None,
        scope_label="Selected enterprises (1)",
        source_count=1,
        scope_member_count=1,
        content_hash="sha256:" + f"{ordinal:064x}",
        prepared_by_account_id=staff.id,
        prepared_by_name=staff.display_name,
        prepared_by_role=staff.role.value,
        finalized_at=finalized_at,
        created_at=finalized_at,
    )
    db.add_all([finalization, version])
    await db.flush([finalization, version])
    return finalization


@contextmanager
def _captured_statements(db: AsyncSession) -> Iterator[list[str]]:
    bind = db.bind
    if not isinstance(bind, AsyncConnection):
        raise RuntimeError("The PostgreSQL read test requires an AsyncConnection-bound session.")
    statements: list[str] = []

    def record_statement(
        _connection: Connection,
        _cursor: object,
        statement: str,
        _parameters: object,
        _context: object,
        _executemany: bool,
    ) -> None:
        statements.append(statement)

    connection = bind.sync_connection
    event.listen(connection, "before_cursor_execute", record_statement)
    try:
        yield statements
    finally:
        event.remove(connection, "before_cursor_execute", record_statement)
