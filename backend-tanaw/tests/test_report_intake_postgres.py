import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.activity_logs.models import ActivityLog
from app.features.events.models import DomainEvent, DomainEventDelivery
from app.features.reporting.contracts import CanonicalReportingPeriod, monthly_reporting_period
from app.features.reporting.envelopes import ReportSubmissionCommand
from app.features.reporting.models import (
    EnterpriseReport,
    ReportingObligation,
    ReportingPeriod,
    ReportIntakeReceipt,
    ReportReviewEvent,
    ReportRevision,
    ReportSourceBatch,
)
from app.features.reporting.service import (
    ReportIntakeConflict,
    ReportIntakeError,
    submit_report_command,
)
from app.features.reporting.workflow import transition_report
from app.features.reporting.workflow_envelopes import ReportTransitionCommand
from app.features.simulation.models import MockDataRun
from app.features.topology.models import (
    Camera,
    EdgeDevice,
    Enterprise,
    EnterpriseMembership,
    EnterpriseSite,
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
async def report_session() -> AsyncIterator[AsyncSession]:
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
async def test_report_intake_is_idempotent_and_hash_conflicts_fail(
    report_session: AsyncSession,
) -> None:
    account, camera_id, period = await _seed_scope(report_session)
    command = ReportSubmissionCommand.model_validate(_command(camera_id, period))

    with pytest.raises(ReportIntakeConflict, match="not open for submissions"):
        await submit_report_command(
            report_session,
            account=account,
            command=command,
            acknowledged_at=period.ends_at - timedelta(seconds=1),
        )

    created = await submit_report_command(
        report_session,
        account=account,
        command=command,
        acknowledged_at=period.ends_at + timedelta(minutes=3),
    )
    replayed = created
    for replay_number in range(100):
        replayed = await submit_report_command(
            report_session,
            account=account,
            command=command,
            acknowledged_at=period.ends_at + timedelta(minutes=4 + replay_number),
        )

    assert created.disposition == "created"
    assert replayed.disposition == "replayed"
    assert replayed.resource.reportRevisionId == created.resource.reportRevisionId
    assert await report_session.scalar(select(func.count()).select_from(EnterpriseReport)) == 1
    assert await report_session.scalar(select(func.count()).select_from(ReportRevision)) == 1
    assert await report_session.scalar(select(func.count()).select_from(ReportReviewEvent)) == 1
    assert await report_session.scalar(select(func.count()).select_from(ReportIntakeReceipt)) == 1
    assert await report_session.scalar(select(func.count()).select_from(DomainEvent)) == 1
    assert await report_session.scalar(select(func.count()).select_from(DomainEventDelivery)) == 2
    source_batch_id = str(command.payload.sourceBatches[0].batchId)
    assert await report_session.get(ReportSourceBatch, source_batch_id) is not None
    review_event = await report_session.scalar(select(ReportReviewEvent))
    assert review_event is not None
    assert review_event.actor_display_name == account.display_name

    report = await report_session.get(
        EnterpriseReport,
        str(created.resource.enterpriseReportId),
    )
    assert report is not None
    report.workflow_state = "returned"
    report.logical_version = 2
    await report_session.flush([report])
    late_replay = await submit_report_command(
        report_session,
        account=account,
        command=command,
        acknowledged_at=period.ends_at + timedelta(minutes=5),
    )
    assert late_replay.resource.logicalVersion == 1

    version_conflict_payload = _command(camera_id, period)
    version_conflict_payload["expectedVersion"] = 2
    with pytest.raises(ReportIntakeConflict, match="different expected logical version"):
        await submit_report_command(
            report_session,
            account=account,
            command=ReportSubmissionCommand.model_validate(version_conflict_payload),
        )

    conflict_payload = _command(camera_id, period)
    conflict_payload["payload"]["notes"] = "Changed after the idempotency key was fixed."
    with pytest.raises(ReportIntakeConflict, match="different payload hash"):
        await submit_report_command(
            report_session,
            account=account,
            command=ReportSubmissionCommand.model_validate(conflict_payload),
        )

    reused_source_payload = _command(camera_id, period)
    reused_source_payload.update(
        commandId=str(uuid4()),
        idempotencyKey="report:install-42:new-local-revision",
        expectedVersion=2,
    )
    reused_source_payload["payload"]["localRevisionId"] = "new-local-revision"
    with pytest.raises(ReportIntakeConflict, match="already bound"):
        await submit_report_command(
            report_session,
            account=account,
            command=ReportSubmissionCommand.model_validate(reused_source_payload),
            acknowledged_at=period.ends_at + timedelta(minutes=6),
        )


@pytest.mark.asyncio
async def test_report_intake_rejects_the_exact_half_open_submission_close(
    report_session: AsyncSession,
) -> None:
    account, camera_id, period = await _seed_scope(report_session)
    command = ReportSubmissionCommand.model_validate(_command(camera_id, period))

    with pytest.raises(ReportIntakeConflict, match="window has closed"):
        await submit_report_command(
            report_session,
            account=account,
            command=command,
            acknowledged_at=period.submission_closes_at,
        )


@pytest.mark.asyncio
async def test_staff_transition_is_versioned_idempotent_and_auditable(
    report_session: AsyncSession,
) -> None:
    enterprise_account, camera_id, period = await _seed_scope(report_session)
    command = ReportSubmissionCommand.model_validate(_command(camera_id, period))
    submitted = await submit_report_command(
        report_session,
        account=enterprise_account,
        command=command,
        acknowledged_at=period.ends_at + timedelta(minutes=3),
    )
    staff = Account(
        id=str(uuid4()),
        email=f"workflow-staff-{uuid4().hex}@example.test",
        password_hash="not-used-by-report-workflow-test",
        role=AccountRole.STAFF,
        display_name="Report Workflow Staff",
        title="Tourism Staff",
        status=AccountStatus.ACTIVE,
        activated_at=period.ends_at,
    )
    report_session.add(staff)
    await report_session.flush([staff])

    accept_command = ReportTransitionCommand.model_validate(
        {
            "contractVersion": 2,
            "commandId": str(uuid4()),
            "expectedVersion": 1,
            "action": "accept_revision",
            "reason": "Evidence reviewed.",
        }
    )
    report_before_acceptance = await report_session.get(
        EnterpriseReport,
        str(submitted.resource.enterpriseReportId),
    )
    assert report_before_acceptance is not None
    report_before_acceptance.acceptance_blocked = True
    await report_session.flush([report_before_acceptance])
    with pytest.raises(ReportIntakeConflict, match="cannot be accepted"):
        await transition_report(
            report_session,
            account=staff,
            enterprise_report_id=submitted.resource.enterpriseReportId,
            command=accept_command,
            acknowledged_at=period.ends_at + timedelta(minutes=4),
        )
    report_before_acceptance.acceptance_blocked = False
    await report_session.flush([report_before_acceptance])

    accepted = await transition_report(
        report_session,
        account=staff,
        enterprise_report_id=submitted.resource.enterpriseReportId,
        command=accept_command,
        acknowledged_at=period.ends_at + timedelta(minutes=4),
    )
    replayed = await transition_report(
        report_session,
        account=staff,
        enterprise_report_id=submitted.resource.enterpriseReportId,
        command=accept_command,
        acknowledged_at=period.ends_at + timedelta(minutes=5),
    )

    assert accepted.disposition == "applied"
    assert replayed.disposition == "replayed"
    assert replayed.acknowledgedAt == accepted.acknowledgedAt
    assert accepted.resource.workflowState == "accepted"
    assert accepted.resource.logicalVersion == 2
    report = await report_session.get(
        EnterpriseReport,
        str(submitted.resource.enterpriseReportId),
    )
    assert report is not None
    assert report.accepted_revision_id == str(submitted.resource.reportRevisionId)
    assert await report_session.scalar(select(func.count()).select_from(ReportReviewEvent)) == 2
    assert await report_session.scalar(select(func.count()).select_from(DomainEvent)) == 2
    assert await report_session.scalar(select(func.count()).select_from(DomainEventDelivery)) == 4
    review_events = list(
        await report_session.scalars(
            select(ReportReviewEvent).order_by(ReportReviewEvent.resulting_version)
        )
    )
    assert [event.actor_display_name for event in review_events] == [
        enterprise_account.display_name,
        staff.display_name,
    ]
    old_activity = ActivityLog(
        id=str(uuid4()),
        timestamp=datetime(1900, 1, 1, tzinfo=UTC),
        category="Staff Operation",
        severity="Success",
        actor=staff.display_name,
        actor_role="LGU Staff",
        action="Legacy Duplicate Report Audit",
        target=str(submitted.resource.enterpriseReportId),
        summary="A purgeable convenience log must not own official workflow history.",
        source_id=str(submitted.resource.enterpriseReportId),
        source_kind="real",
    )
    report_session.add(old_activity)
    await report_session.flush([old_activity])
    await report_session.execute(
        delete(ActivityLog).where(
            ActivityLog.id == old_activity.id,
            ActivityLog.timestamp < datetime(1901, 1, 1, tzinfo=UTC),
        )
    )
    await report_session.flush()
    assert await report_session.get(ActivityLog, old_activity.id) is None
    assert await report_session.scalar(select(func.count()).select_from(ReportReviewEvent)) == 2
    stale_command = ReportTransitionCommand.model_validate(
        {
            "contractVersion": 2,
            "commandId": str(uuid4()),
            "expectedVersion": 1,
            "action": "reopen_before_finalization",
            "reason": "A correction is required.",
        }
    )
    with pytest.raises(ReportIntakeConflict, match="current version is 2"):
        await transition_report(
            report_session,
            account=staff,
            enterprise_report_id=submitted.resource.enterpriseReportId,
            command=stale_command,
        )

    reopen_command = stale_command.model_copy(update={"commandId": uuid4(), "expectedVersion": 2})
    reopened = await transition_report(
        report_session,
        account=staff,
        enterprise_report_id=submitted.resource.enterpriseReportId,
        command=reopen_command,
        acknowledged_at=period.ends_at + timedelta(minutes=6),
    )
    assert reopened.resource.workflowState == "returned"
    assert reopened.resource.logicalVersion == 3
    assert report.accepted_revision_id is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "invalid_scope",
    (
        "future_membership",
        "ended_membership",
        "ambiguous_membership",
        "inactive_enterprise",
        "future_site",
        "ended_site",
        "retired_device",
        "retired_camera",
    ),
)
async def test_report_intake_rejects_invalid_effective_topology(
    report_session: AsyncSession,
    invalid_scope: str,
) -> None:
    account, camera_id, period = await _seed_scope(report_session)
    acknowledged_at = period.ends_at + timedelta(minutes=3)
    membership, enterprise, site, device, camera = await _load_topology(
        report_session,
        account=account,
        camera_id=camera_id,
    )

    if invalid_scope == "future_membership":
        membership.started_at = acknowledged_at + timedelta(seconds=1)
    elif invalid_scope == "ended_membership":
        membership.ended_at = acknowledged_at
    elif invalid_scope == "ambiguous_membership":
        membership.ended_at = acknowledged_at + timedelta(days=2)
        await report_session.flush([membership])
        report_session.add(
            EnterpriseMembership(
                id=str(uuid4()),
                enterprise_id=enterprise.id,
                account_id=account.id,
                classification=enterprise.classification,
                membership_role="manager",
                started_at=acknowledged_at - timedelta(days=1),
                ended_at=acknowledged_at + timedelta(days=1),
            )
        )
    elif invalid_scope == "inactive_enterprise":
        enterprise.lifecycle_state = "inactive"
    elif invalid_scope == "future_site":
        site.effective_from = acknowledged_at + timedelta(seconds=1)
    elif invalid_scope == "ended_site":
        site.effective_to = acknowledged_at
    elif invalid_scope == "retired_device":
        device.lifecycle_state = "retired"
    elif invalid_scope == "retired_camera":
        camera.lifecycle_state = "retired"
    else:  # pragma: no cover - the parameter list is intentionally exhaustive.
        raise AssertionError(f"Unhandled topology case: {invalid_scope}")
    await report_session.flush()

    command = ReportSubmissionCommand.model_validate(_command(camera_id, period))
    with pytest.raises(
        ReportIntakeError,
        match="effective|active|owned by the enterprise|exactly one enterprise membership",
    ):
        await submit_report_command(
            report_session,
            account=account,
            command=command,
            acknowledged_at=acknowledged_at,
        )


@pytest.mark.asyncio
async def test_report_intake_rejects_source_camera_classification_mismatch(
    report_session: AsyncSession,
) -> None:
    account, _camera_id, period = await _seed_scope(report_session)
    _simulation_account, simulation_camera_id, _simulation_period = await _seed_scope(
        report_session,
        classification="simulation",
        period_year=period.local_start_date.year + 1,
    )
    command = ReportSubmissionCommand.model_validate(_command(simulation_camera_id, period))

    with pytest.raises(ReportIntakeError, match="active camera owned by the enterprise"):
        await submit_report_command(
            report_session,
            account=account,
            command=command,
            acknowledged_at=period.ends_at + timedelta(minutes=3),
        )


@pytest.mark.asyncio
async def test_report_intake_accepts_bounded_topology_effective_at_acknowledgement(
    report_session: AsyncSession,
) -> None:
    account, camera_id, period = await _seed_scope(report_session)
    acknowledged_at = period.ends_at + timedelta(minutes=3)
    membership, _enterprise, site, _device, _camera = await _load_topology(
        report_session,
        account=account,
        camera_id=camera_id,
    )
    membership.ended_at = acknowledged_at + timedelta(seconds=1)
    site.effective_to = acknowledged_at + timedelta(seconds=1)
    await report_session.flush([membership, site])

    submitted = await submit_report_command(
        report_session,
        account=account,
        command=ReportSubmissionCommand.model_validate(_command(camera_id, period)),
        acknowledged_at=acknowledged_at,
    )

    assert submitted.disposition == "created"


async def _seed_scope(
    db: AsyncSession,
    *,
    classification: str = "official",
    period_year: int | None = None,
) -> tuple[Account, str, CanonicalReportingPeriod]:
    suffix = uuid4().hex
    now = datetime(2026, 6, 1, tzinfo=UTC)
    account = Account(
        id=str(uuid4()),
        email=f"report-intake-{suffix}@example.test",
        password_hash="not-used-by-report-intake-test",
        role=AccountRole.ENTERPRISE,
        display_name="Report Intake Test",
        title="Enterprise Manager",
        status=AccountStatus.ACTIVE,
        activated_at=now,
    )
    enterprise = Enterprise(
        id=str(uuid4()),
        official_code=f"REPORT-INTAKE-{suffix}",
        name="Report Intake Enterprise",
        classification=classification,
        lifecycle_state="active",
    )
    simulation_run = (
        MockDataRun(
            id=str(uuid4()),
            scenario="report-intake-scope-test",
            seed=suffix,
            range_start=now - timedelta(days=1),
            range_end=now,
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
        name="Report Intake Site",
        barangay="Poblacion",
        timezone_name="Asia/Manila",
        building_capacity=100,
        location_version=1,
        effective_from=now,
    )
    membership = EnterpriseMembership(
        id=str(uuid4()),
        enterprise_id=enterprise.id,
        account_id=account.id,
        classification=classification,
        membership_role="owner",
        started_at=now,
    )
    device = EdgeDevice(
        id=str(uuid4()),
        site_id=site.id,
        classification=classification,
        device_key=f"device-{suffix}",
        display_name="Report Intake Device",
        lifecycle_state="active",
    )
    camera = Camera(
        id=str(uuid4()),
        site_id=site.id,
        edge_device_id=device.id,
        classification=classification,
        camera_key=f"camera-{suffix}",
        display_name="Report Intake Camera",
        lifecycle_state="active",
    )
    canonical_period = monthly_reporting_period(
        period_year if period_year is not None else 7000 + uuid4().int % 2000,
        6,
    )
    period = ReportingPeriod(
        id=str(uuid4()),
        natural_key=canonical_period.natural_key,
        cadence="month",
        timezone_name=canonical_period.timezone,
        local_start_date=canonical_period.local_start_date,
        local_end_date=canonical_period.local_end_date,
        starts_at=canonical_period.starts_at,
        ends_at=canonical_period.ends_at,
        submission_opens_at=canonical_period.submission_opens_at,
        submission_closes_at=canonical_period.submission_closes_at,
        status="open",
        label=f"June 2026 {suffix}",
    )
    obligation = ReportingObligation(
        id=str(uuid4()),
        reporting_period_id=period.id,
        enterprise_id=enterprise.id,
        site_id=site.id,
        classification=classification,
        eligibility_status="eligible",
        eligibility_basis="registry_snapshot",
        frozen_barangay=site.barangay,
        enterprise_official_code=enterprise.official_code,
        enterprise_name=enterprise.name,
        site_code=site.site_code,
        site_name=site.name,
        timezone_name="Asia/Manila",
        registration_effective_at=now,
        acceptance_blocked=False,
    )
    db.add_all(
        [account, *([simulation_run] if simulation_run is not None else []), enterprise, period]
    )
    await db.flush()
    db.add_all([site, membership])
    await db.flush()
    db.add_all([device, obligation])
    await db.flush()
    db.add(camera)
    await db.flush()
    return account, camera.id, canonical_period


async def _load_topology(
    db: AsyncSession,
    *,
    account: Account,
    camera_id: str,
) -> tuple[EnterpriseMembership, Enterprise, EnterpriseSite, EdgeDevice, Camera]:
    membership = await db.scalar(
        select(EnterpriseMembership).where(EnterpriseMembership.account_id == account.id)
    )
    camera = await db.get(Camera, camera_id)
    assert membership is not None
    assert camera is not None
    enterprise = await db.get(Enterprise, membership.enterprise_id)
    site = await db.get(EnterpriseSite, camera.site_id)
    device = await db.get(EdgeDevice, camera.edge_device_id)
    assert enterprise is not None
    assert site is not None
    assert device is not None
    return membership, enterprise, site, device, camera


def _command(camera_id: str, period: CanonicalReportingPeriod) -> dict:
    occurred_at = period.ends_at + timedelta(minutes=2)
    return {
        "contractVersion": 2,
        "commandId": "018fbf1a-9bf0-7f5f-a70e-001122334455",
        "idempotencyKey": "report:install-42:local-revision-0190",
        "occurredAt": occurred_at.isoformat(),
        "expectedVersion": 0,
        "payload": {
            "periodKey": period.natural_key,
            "localRevisionId": "local-revision-0190",
            "sourceWindow": {
                "start": period.starts_at.isoformat(),
                "end": period.ends_at.isoformat(),
            },
            "sourceBatches": [
                {
                    "batchId": "018fbf1a-9bf0-7f5f-a70e-001122334466",
                    "cameraId": camera_id,
                    "eventCount": 10,
                    "eventSequenceStart": 1000,
                    "eventSequenceEndExclusive": 1010,
                    "aggregateHash": f"sha256:{'a' * 64}",
                }
            ],
            "metrics": [
                {
                    "definition": "entries",
                    "definitionVersion": 1,
                    "value": 10,
                    "unit": "events",
                    "grain": "site",
                    "windowStart": period.starts_at.isoformat(),
                    "windowEnd": period.ends_at.isoformat(),
                    "timezone": "Asia/Manila",
                    "provenance": "camera_derived",
                    "quality": "confirmed",
                    "coverage": {
                        "evidenceStatus": "recorded",
                        "monitoredSeconds": 2_592_000,
                        "expectedSeconds": 2_592_000,
                        "gapCount": 0,
                    },
                }
            ],
            "demographicFacts": [],
            "coverage": {
                "evidenceStatus": "recorded",
                "monitoredSeconds": 2_592_000,
                "expectedSeconds": 2_592_000,
                "gaps": [],
            },
            "notes": None,
        },
    }
