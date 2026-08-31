import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core import security
from app.core.config import Settings
from app.core.security import create_access_token
from app.db.session import get_db
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
)
from app.features.realtime.models import RealtimeOutbox
from app.features.reporting import router as reporting_router
from app.features.reporting.errors import (
    InvalidReportWorkflowError,
    ReportAlreadyConsolidatedError,
)
from app.features.reporting.final_reports import (
    create_final_report,
    return_final_report_for_revision,
    to_final_report_summary,
)
from app.features.reporting.intake import ingest_report_submission, update_report_status
from app.features.reporting.models import (
    EnterpriseReportSubmission,
    FinalReport,
    FinalReportSource,
)
from app.features.reporting.schemas import (
    DesktopReportSubmissionIngest,
    FinalReportCreate,
    FinalReportRevisionReturn,
    FinalReportSummary,
    IntakeReportSummary,
    ReportStatusUpdate,
)
from tests.support.postgres import PostgresRuntime, postgres_test_database_url

TEST_EMAIL_PATTERN = "tanaw-reporting-pg-%@example.com"
TEST_PREPARED_BY_PREFIX = "Reporting PG"


@dataclass(frozen=True)
class CreatedEnterprise:
    id: str
    email: str


@pytest_asyncio.fixture
async def postgres_runtime(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[PostgresRuntime]:
    database_url = postgres_test_database_url()
    engine = create_async_engine(database_url, pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    settings = Settings(
        environment="development",
        database_url=database_url,
        jwt_secret_key="tanaw-reporting-postgres-jwt-secret-123456789",
    )
    monkeypatch.setattr(security, "get_settings", lambda: settings)
    monkeypatch.setattr(
        reporting_router,
        "create_role_notifications",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(
        reporting_router,
        "record_operational_log",
        AsyncMock(return_value=None),
    )

    runtime = PostgresRuntime(engine=engine, sessions=sessions, settings=settings)
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
        intake_ids = (
            list(
                await db.scalars(
                    select(EnterpriseReportSubmission.id).where(
                        EnterpriseReportSubmission.enterprise_profile_id.in_(account_ids)
                    )
                )
            )
            if account_ids
            else []
        )
        linked_final_ids = (
            list(
                await db.scalars(
                    select(FinalReportSource.final_report_id).where(
                        FinalReportSource.intake_report_id.in_(intake_ids)
                    )
                )
            )
            if intake_ids
            else []
        )
        prepared_final_ids = list(
            await db.scalars(
                select(FinalReport.id).where(
                    FinalReport.prepared_by.like(f"{TEST_PREPARED_BY_PREFIX}%")
                )
            )
        )
        final_ids = list(set([*linked_final_ids, *prepared_final_ids]))

        outbox_conditions = []
        if account_ids:
            outbox_conditions.extend(
                [
                    RealtimeOutbox.scope["enterprise_account_id"].as_string().in_(account_ids),
                    RealtimeOutbox.payload["account_id"].as_string().in_(account_ids),
                ]
            )
        report_event_ids = [*intake_ids, *final_ids]
        if report_event_ids:
            outbox_conditions.append(
                RealtimeOutbox.payload["report_id"].as_string().in_(report_event_ids)
            )
        if outbox_conditions:
            await db.execute(delete(RealtimeOutbox).where(or_(*outbox_conditions)))
        if final_ids:
            await db.execute(delete(FinalReport).where(FinalReport.id.in_(final_ids)))
        if intake_ids:
            await db.execute(
                delete(EnterpriseReportSubmission).where(
                    EnterpriseReportSubmission.id.in_(intake_ids)
                )
            )
        if account_ids:
            await db.execute(delete(Account).where(Account.id.in_(account_ids)))
        await db.commit()


async def _create_enterprise(runtime: PostgresRuntime, *, label: str) -> CreatedEnterprise:
    suffix = uuid4().hex[:10]
    account = Account(
        id=str(uuid4()),
        email=f"tanaw-reporting-pg-{label}-{suffix}@example.com",
        password_hash="unused-test-password-hash",
        role=AccountRole.ENTERPRISE,
        display_name=f"Reporting Test {label}",
        title="Enterprise Account",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
        password_changed_at=datetime.now(UTC),
        enterprise_profile=EnterpriseProfile(
            enterprise_id=f"reporting-test-{label}-{suffix}",
            enterprise_name=f"Reporting Test {label}",
            category="business",
            manager_name=f"Reporting Test Manager {label}",
            barangay="Poblacion",
        ),
    )
    async with runtime.sessions() as db:
        db.add(account)
        await db.commit()
    return CreatedEnterprise(id=account.id, email=account.email)


def _submission(
    report_id: str,
    period: str,
    *,
    status: str = "Submitted",
    entries: int = 12,
    exits: int = 7,
    unique_count: int = 6,
) -> DesktopReportSubmissionIngest:
    month_name, year_text = period.split()
    month = datetime.strptime(month_name, "%B").month
    year = int(year_text)
    next_month = 1 if month == 12 else month + 1
    next_year = year + 1 if month == 12 else year
    submitted_at = datetime(next_year, next_month, 2, 8, tzinfo=UTC)
    demographics = {
        "thisProvMale": str(unique_count),
        "thisProvFemale": "0",
        "otherProvMale": "0",
        "otherProvFemale": "0",
        "foreignMale": "0",
        "foreignFemale": "0",
    }
    return DesktopReportSubmissionIngest(
        submissionId=uuid4(),
        reportId=report_id,
        period=period,
        submittedAt=submitted_at,
        entries=entries,
        exits=exits,
        peakOccupancy=max(entries - exits, 1),
        uniqueCount=unique_count,
        payload={
            "status": status,
            "demo": demographics,
            "metrics": {
                "entries": entries,
                "exits": exits,
                "peak": max(entries - exits, 1),
                "unique": unique_count,
            },
        },
    )


async def _ingest(
    runtime: PostgresRuntime,
    enterprise: CreatedEnterprise,
    payload: DesktopReportSubmissionIngest,
) -> IntakeReportSummary:
    async with runtime.sessions() as db:
        account = await db.get(Account, enterprise.id)
        assert account is not None
        try:
            report = await ingest_report_submission(db, account, payload)
            await db.commit()
            return report
        except BaseException:
            await db.rollback()
            raise


async def _ready_report(
    runtime: PostgresRuntime,
    enterprise: CreatedEnterprise,
    payload: DesktopReportSubmissionIngest,
) -> IntakeReportSummary:
    report = await _ingest(runtime, enterprise, payload)
    async with runtime.sessions() as db:
        ready = await update_report_status(
            db,
            report.id,
            ReportStatusUpdate(status="Ready to Consolidate"),
        )
        assert ready is not None
        await db.commit()
        return ready


async def _consolidate(
    runtime: PostgresRuntime,
    report_ids: list[str],
    *,
    prepared_by: str,
) -> FinalReportSummary:
    async with runtime.sessions() as db:
        try:
            report = await create_final_report(
                db,
                FinalReportCreate(reportIds=report_ids, preparedBy=prepared_by),
            )
            assert report is not None
            await db.commit()
            return report
        except BaseException:
            await db.rollback()
            raise


def _create_test_app(runtime: PostgresRuntime) -> FastAPI:
    application = FastAPI()
    application.include_router(reporting_router.router)

    async def test_db() -> AsyncIterator[AsyncSession]:
        async with runtime.sessions() as db:
            try:
                yield db
                await db.commit()
            except BaseException:
                await db.rollback()
                raise

    application.dependency_overrides[get_db] = test_db
    return application


def _authorization(account: CreatedEnterprise) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(account.id)}"}


@pytest.mark.asyncio
async def test_concurrent_same_enterprise_period_accepts_exactly_one_request(
    postgres_runtime: PostgresRuntime,
) -> None:
    enterprise = await _create_enterprise(postgres_runtime, label="period-race")
    application = _create_test_app(postgres_runtime)
    transport = ASGITransport(app=application)
    first = _submission("REP-RACE-001", "June 2026").model_dump(mode="json")
    second = _submission("REP-RACE-002", "June 2026").model_dump(mode="json")

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        responses = await asyncio.gather(
            client.post(
                "/operational/desktop/report-submissions",
                headers=_authorization(enterprise),
                json=first,
            ),
            client.post(
                "/operational/desktop/report-submissions",
                headers=_authorization(enterprise),
                json=second,
            ),
        )
        assert sorted(response.status_code for response in responses) == [202, 409]
        conflict = next(response for response in responses if response.status_code == 409)
        assert "June 2026" in conflict.json()["detail"]

        repeated = await client.post(
            "/operational/desktop/report-submissions",
            headers=_authorization(enterprise),
            json=_submission("REP-RACE-003", "June 2026").model_dump(mode="json"),
        )
        assert repeated.status_code == 409

    async with postgres_runtime.sessions() as db:
        count = await db.scalar(
            select(func.count())
            .select_from(EnterpriseReportSubmission)
            .where(
                EnterpriseReportSubmission.enterprise_profile_id == enterprise.id,
                EnterpriseReportSubmission.period == "June 2026",
            )
        )
        assert count == 1


@pytest.mark.asyncio
async def test_period_uniqueness_is_scoped_by_enterprise_and_period(
    postgres_runtime: PostgresRuntime,
) -> None:
    first_enterprise = await _create_enterprise(postgres_runtime, label="scope-one")
    second_enterprise = await _create_enterprise(postgres_runtime, label="scope-two")

    await _ingest(
        postgres_runtime,
        first_enterprise,
        _submission("REP-SCOPE-001", "June 2026"),
    )
    await _ingest(
        postgres_runtime,
        first_enterprise,
        _submission("REP-SCOPE-002", "July 2026"),
    )
    await _ingest(
        postgres_runtime,
        second_enterprise,
        _submission("REP-SCOPE-003", "June 2026"),
    )

    async with postgres_runtime.sessions() as db:
        count = await db.scalar(
            select(func.count())
            .select_from(EnterpriseReportSubmission)
            .where(
                EnterpriseReportSubmission.enterprise_profile_id.in_(
                    [first_enterprise.id, second_enterprise.id]
                )
            )
        )
        assert count == 3


@pytest.mark.asyncio
async def test_only_returned_reports_can_be_resubmitted(
    postgres_runtime: PostgresRuntime,
) -> None:
    enterprise = await _create_enterprise(postgres_runtime, label="resubmit")
    original = await _ingest(
        postgres_runtime,
        enterprise,
        _submission("REP-RESUBMIT-001", "June 2026"),
    )

    with pytest.raises(InvalidReportWorkflowError):
        await _ingest(
            postgres_runtime,
            enterprise,
            _submission(
                "REP-RESUBMIT-001",
                "June 2026",
                status="Resubmitted",
                entries=20,
                exits=10,
                unique_count=8,
            ),
        )

    async with postgres_runtime.sessions() as db:
        returned = await update_report_status(
            db,
            original.id,
            ReportStatusUpdate(status="Returned", remarks="Correct the submitted totals."),
        )
        assert returned is not None
        await db.commit()

    revised = await _ingest(
        postgres_runtime,
        enterprise,
        _submission(
            "REP-RESUBMIT-001",
            "June 2026",
            status="Resubmitted",
            entries=20,
            exits=10,
            unique_count=8,
        ),
    )
    assert revised.id == original.id
    assert revised.status == "Pending Review"
    assert revised.metrics["entry"] == 20

    with pytest.raises(InvalidReportWorkflowError):
        await _ingest(
            postgres_runtime,
            enterprise,
            _submission(
                "REP-RESUBMIT-001",
                "June 2026",
                status="Resubmitted",
                entries=30,
                exits=15,
                unique_count=10,
            ),
        )

    async with postgres_runtime.sessions() as db:
        count = await db.scalar(
            select(func.count())
            .select_from(EnterpriseReportSubmission)
            .where(
                EnterpriseReportSubmission.enterprise_profile_id == enterprise.id,
                EnterpriseReportSubmission.period == "June 2026",
            )
        )
        assert count == 1


@pytest.mark.asyncio
async def test_consolidation_transitions_sources_and_freezes_snapshot(
    postgres_runtime: PostgresRuntime,
) -> None:
    first_enterprise = await _create_enterprise(postgres_runtime, label="snapshot-one")
    second_enterprise = await _create_enterprise(postgres_runtime, label="snapshot-two")
    first = await _ready_report(
        postgres_runtime,
        first_enterprise,
        _submission("REP-SNAPSHOT-001", "June 2026", unique_count=6),
    )
    second = await _ready_report(
        postgres_runtime,
        second_enterprise,
        _submission("REP-SNAPSHOT-002", "June 2026", unique_count=9),
    )

    final = await _consolidate(
        postgres_runtime,
        [first.id, second.id],
        prepared_by=f"{TEST_PREPARED_BY_PREFIX} Snapshot",
    )
    assert final.totalUnique == 15
    assert {source.unique for source in final.sources} == {6, 9}
    assert all(source.demographics is not None for source in final.sources)

    async with postgres_runtime.sessions() as db:
        stored_reports = list(
            await db.scalars(
                select(EnterpriseReportSubmission).where(
                    EnterpriseReportSubmission.id.in_([first.id, second.id])
                )
            )
        )
        assert {report.review_status for report in stored_reports} == {"Consolidated"}
        first_stored = next(report for report in stored_reports if report.id == first.id)
        first_stored.enterprise_name = "Mutated Enterprise"
        first_stored.report_id = "REP-MUTATED"
        first_stored.entries = 999
        first_stored.exits = 888
        first_stored.unique_count = 12
        first_stored.payload_json = json.dumps(
            {
                "demo": {
                    "thisProvMale": "0",
                    "thisProvFemale": "12",
                    "otherProvMale": "0",
                    "otherProvFemale": "0",
                    "foreignMale": "0",
                    "foreignFemale": "0",
                }
            }
        )
        await db.commit()

    async with postgres_runtime.sessions() as db:
        stored_final = await db.scalar(
            select(FinalReport).where(FinalReport.report_code == final.id)
        )
        assert stored_final is not None
        unchanged = await to_final_report_summary(db, stored_final)
        first_snapshot = next(source for source in unchanged.sources if source.id == first.id)
        assert first_snapshot.enterprise != "Mutated Enterprise"
        assert first_snapshot.code == "REP-SNAPSHOT-001"
        assert first_snapshot.entry == 12
        assert first_snapshot.exit == 7
        assert first_snapshot.unique == 6
        assert first_snapshot.demographics is not None
        assert first_snapshot.demographics.thisProvMale == 6


@pytest.mark.asyncio
async def test_source_cannot_be_added_to_a_second_final_report(
    postgres_runtime: PostgresRuntime,
) -> None:
    enterprise = await _create_enterprise(postgres_runtime, label="source-reuse")
    source = await _ready_report(
        postgres_runtime,
        enterprise,
        _submission("REP-REUSE-001", "June 2026"),
    )
    await _consolidate(
        postgres_runtime,
        [source.id],
        prepared_by=f"{TEST_PREPARED_BY_PREFIX} Reuse First",
    )

    async with postgres_runtime.sessions() as db:
        stored = await db.get(EnterpriseReportSubmission, source.id)
        assert stored is not None
        stored.review_status = "Ready to Consolidate"
        await db.commit()

    with pytest.raises(ReportAlreadyConsolidatedError):
        await _consolidate(
            postgres_runtime,
            [source.id],
            prepared_by=f"{TEST_PREPARED_BY_PREFIX} Reuse Second",
        )

    async with postgres_runtime.sessions() as db:
        duplicate_final = FinalReport(
            report_code=f"CON-TEST-{uuid4().hex[:12]}",
            title="Database uniqueness verification",
            period="June 2026",
            generated_on=datetime.now(UTC),
            prepared_by=f"{TEST_PREPARED_BY_PREFIX} Direct Constraint",
            prepared_role="Staff Processing Division",
            status="Draft",
            total_entry=12,
            total_exit=7,
            total_unique=6,
            enterprise_count=1,
        )
        db.add(duplicate_final)
        await db.flush()
        db.add(
            FinalReportSource(
                final_report_id=duplicate_final.id,
                intake_report_id=source.id,
                enterprise="Duplicate Constraint Test",
                code="REP-REUSE-001",
                unique_count=6,
                entries=12,
                exits=7,
            )
        )
        with pytest.raises(IntegrityError):
            await db.flush()
        await db.rollback()

    async with postgres_runtime.sessions() as db:
        source_count = await db.scalar(
            select(func.count())
            .select_from(FinalReportSource)
            .where(FinalReportSource.intake_report_id == source.id)
        )
        assert source_count == 1


@pytest.mark.asyncio
async def test_concurrent_consolidation_of_same_sources_creates_one_final_report(
    postgres_runtime: PostgresRuntime,
) -> None:
    first_enterprise = await _create_enterprise(postgres_runtime, label="final-race-one")
    second_enterprise = await _create_enterprise(postgres_runtime, label="final-race-two")
    first = await _ready_report(
        postgres_runtime,
        first_enterprise,
        _submission("REP-FINAL-RACE-001", "June 2026"),
    )
    second = await _ready_report(
        postgres_runtime,
        second_enterprise,
        _submission("REP-FINAL-RACE-002", "June 2026"),
    )

    async def attempt(label: str) -> FinalReportSummary | InvalidReportWorkflowError:
        try:
            return await _consolidate(
                postgres_runtime,
                [first.id, second.id],
                prepared_by=f"{TEST_PREPARED_BY_PREFIX} {label}",
            )
        except InvalidReportWorkflowError as exc:
            return exc

    outcomes = await asyncio.gather(attempt("Race One"), attempt("Race Two"))
    assert sum(not isinstance(outcome, Exception) for outcome in outcomes) == 1
    assert sum(isinstance(outcome, InvalidReportWorkflowError) for outcome in outcomes) == 1

    async with postgres_runtime.sessions() as db:
        final_ids = list(
            await db.scalars(
                select(FinalReportSource.final_report_id)
                .where(FinalReportSource.intake_report_id.in_([first.id, second.id]))
                .distinct()
            )
        )
        assert len(final_ids) == 1


@pytest.mark.asyncio
async def test_failed_consolidation_leaves_no_partial_final_report(
    postgres_runtime: PostgresRuntime,
) -> None:
    ready_enterprise = await _create_enterprise(postgres_runtime, label="rollback-ready")
    pending_enterprise = await _create_enterprise(postgres_runtime, label="rollback-pending")
    ready = await _ready_report(
        postgres_runtime,
        ready_enterprise,
        _submission("REP-ROLLBACK-001", "June 2026"),
    )
    pending = await _ingest(
        postgres_runtime,
        pending_enterprise,
        _submission("REP-ROLLBACK-002", "June 2026"),
    )

    with pytest.raises(InvalidReportWorkflowError):
        await _consolidate(
            postgres_runtime,
            [ready.id, pending.id],
            prepared_by=f"{TEST_PREPARED_BY_PREFIX} Rollback",
        )

    async with postgres_runtime.sessions() as db:
        final_count = await db.scalar(
            select(func.count())
            .select_from(FinalReport)
            .where(FinalReport.prepared_by == f"{TEST_PREPARED_BY_PREFIX} Rollback")
        )
        source_count = await db.scalar(
            select(func.count())
            .select_from(FinalReportSource)
            .where(FinalReportSource.intake_report_id.in_([ready.id, pending.id]))
        )
        stored_ready = await db.get(EnterpriseReportSubmission, ready.id)
        stored_pending = await db.get(EnterpriseReportSubmission, pending.id)
        assert final_count == 0
        assert source_count == 0
        assert stored_ready is not None and stored_ready.review_status == "Ready to Consolidate"
        assert stored_pending is not None and stored_pending.review_status == "Pending Review"


@pytest.mark.asyncio
async def test_concurrent_disjoint_final_reports_receive_unique_codes(
    postgres_runtime: PostgresRuntime,
) -> None:
    enterprises = [
        await _create_enterprise(postgres_runtime, label=f"code-{index}") for index in range(2)
    ]
    reports = [
        await _ready_report(
            postgres_runtime,
            enterprise,
            _submission(f"REP-CODE-{index}", "June 2026"),
        )
        for index, enterprise in enumerate(enterprises)
    ]

    finals = await asyncio.gather(
        *[
            _consolidate(
                postgres_runtime,
                [report.id],
                prepared_by=f"{TEST_PREPARED_BY_PREFIX} Code {index}",
            )
            for index, report in enumerate(reports)
        ]
    )
    assert len({report.id for report in finals}) == 2
    assert all(report.id.startswith("CON-JUN-2026-") for report in finals)


@pytest.mark.asyncio
async def test_returned_sources_reconsolidate_into_the_same_final_report(
    postgres_runtime: PostgresRuntime,
) -> None:
    first_enterprise = await _create_enterprise(postgres_runtime, label="revision-one")
    second_enterprise = await _create_enterprise(postgres_runtime, label="revision-two")
    first = await _ready_report(
        postgres_runtime,
        first_enterprise,
        _submission("REP-REVISION-001", "June 2026", unique_count=6),
    )
    second = await _ready_report(
        postgres_runtime,
        second_enterprise,
        _submission("REP-REVISION-002", "June 2026", unique_count=7),
    )
    original_final = await _consolidate(
        postgres_runtime,
        [first.id, second.id],
        prepared_by=f"{TEST_PREPARED_BY_PREFIX} Revision Original",
    )

    async with postgres_runtime.sessions() as db:
        returned = await return_final_report_for_revision(
            db,
            original_final.id,
            FinalReportRevisionReturn(
                sourceReportIds=[first.id],
                remarks="Correct the first source demographics.",
            ),
        )
        assert returned is not None
        await db.commit()

    revised_intake = await _ingest(
        postgres_runtime,
        first_enterprise,
        _submission(
            "REP-REVISION-001",
            "June 2026",
            status="Resubmitted",
            entries=18,
            exits=9,
            unique_count=8,
        ),
    )
    async with postgres_runtime.sessions() as db:
        ready = await update_report_status(
            db,
            revised_intake.id,
            ReportStatusUpdate(status="Ready to Consolidate"),
        )
        assert ready is not None
        await db.commit()

    reconsolidated = await _consolidate(
        postgres_runtime,
        [first.id, second.id],
        prepared_by=f"{TEST_PREPARED_BY_PREFIX} Revision Updated",
    )
    assert reconsolidated.id == original_final.id
    assert reconsolidated.status == "Draft"
    first_snapshot = next(source for source in reconsolidated.sources if source.id == first.id)
    assert first_snapshot.unique == 8

    async with postgres_runtime.sessions() as db:
        final_ids = list(
            await db.scalars(
                select(FinalReportSource.final_report_id)
                .where(FinalReportSource.intake_report_id.in_([first.id, second.id]))
                .distinct()
            )
        )
        source_count = await db.scalar(
            select(func.count())
            .select_from(FinalReportSource)
            .where(FinalReportSource.intake_report_id.in_([first.id, second.id]))
        )
        assert len(final_ids) == 1
        assert source_count == 2
