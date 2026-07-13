import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from app.features.accounts.models import Account, AccountRole, AccountStatus
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
from app.features.reporting.service import ReportIntakeConflict, submit_report_command
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


async def _seed_scope(
    db: AsyncSession,
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
        classification="official",
        lifecycle_state="active",
    )
    site = EnterpriseSite(
        id=str(uuid4()),
        enterprise_id=enterprise.id,
        classification="official",
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
        classification="official",
        membership_role="owner",
        started_at=now,
    )
    device = EdgeDevice(
        id=str(uuid4()),
        site_id=site.id,
        classification="official",
        device_key=f"device-{suffix}",
        display_name="Report Intake Device",
        lifecycle_state="active",
    )
    camera = Camera(
        id=str(uuid4()),
        site_id=site.id,
        edge_device_id=device.id,
        classification="official",
        camera_key=f"camera-{suffix}",
        display_name="Report Intake Camera",
        lifecycle_state="active",
    )
    canonical_period = monthly_reporting_period(7000 + uuid4().int % 2000, 6)
    period = ReportingPeriod(
        id=str(uuid4()),
        natural_key=canonical_period.natural_key,
        cadence="month",
        timezone_name=canonical_period.timezone,
        local_start_date=canonical_period.local_start_date,
        local_end_date=canonical_period.local_end_date,
        starts_at=canonical_period.starts_at,
        ends_at=canonical_period.ends_at,
        submission_opens_at=canonical_period.ends_at,
        label=f"June 2026 {suffix}",
    )
    obligation = ReportingObligation(
        id=str(uuid4()),
        reporting_period_id=period.id,
        enterprise_id=enterprise.id,
        site_id=site.id,
        classification="official",
        eligibility_status="eligible",
        eligibility_basis="registry_snapshot",
        frozen_barangay=site.barangay,
        timezone_name="Asia/Manila",
        registration_effective_at=now,
        acceptance_blocked=False,
    )
    db.add_all([account, enterprise, period])
    await db.flush()
    db.add_all([site, membership])
    await db.flush()
    db.add_all([device, obligation])
    await db.flush()
    db.add(camera)
    await db.flush()
    return account, camera.id, canonical_period


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
