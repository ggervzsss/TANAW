import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import delete, func, or_, select
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
from app.features.activity_logs.models import ActivityLog
from app.features.notifications.models import UserNotification
from app.features.realtime.models import RealtimeOutbox
from app.features.reporting import router as reporting_router
from app.features.reporting.intake import update_report_status
from app.features.reporting.models import (
    EnterpriseReportSubmission,
    ReportSubmissionOperation,
)
from app.features.reporting.schemas import IntakeReportSummary, ReportStatusUpdate
from tests.support.postgres import PostgresRuntime, postgres_test_database_url

TEST_EMAIL_PATTERN = "tanaw-idempotency-pg-%@example.com"


@dataclass(frozen=True)
class CreatedAccount:
    id: str
    email: str


@dataclass(frozen=True)
class SideEffectCounts:
    operations: int
    activities: int
    notifications: int
    report_events: int
    activity_events: int
    notification_events: int


@pytest_asyncio.fixture
async def postgres_runtime(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[PostgresRuntime]:
    database_url = postgres_test_database_url()
    engine = create_async_engine(database_url, pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    settings = Settings(
        environment="development",
        database_url=database_url,
        jwt_secret_key="tanaw-report-idempotency-jwt-secret-123456789",
    )
    monkeypatch.setattr(security, "get_settings", lambda: settings)
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
        if intake_ids:
            await db.execute(
                delete(RealtimeOutbox).where(
                    or_(
                        RealtimeOutbox.payload["report_id"].as_string().in_(intake_ids),
                        RealtimeOutbox.payload["source_id"].as_string().in_(intake_ids),
                    )
                )
            )
            await db.execute(delete(ActivityLog).where(ActivityLog.source_id.in_(intake_ids)))
            await db.execute(
                delete(UserNotification).where(UserNotification.source_id.in_(intake_ids))
            )
            await db.execute(
                delete(ReportSubmissionOperation).where(
                    ReportSubmissionOperation.intake_report_id.in_(intake_ids)
                )
            )
            await db.execute(
                delete(EnterpriseReportSubmission).where(
                    EnterpriseReportSubmission.id.in_(intake_ids)
                )
            )
        if account_ids:
            await db.execute(
                delete(RealtimeOutbox).where(
                    or_(
                        RealtimeOutbox.scope["recipient_account_id"].as_string().in_(account_ids),
                        RealtimeOutbox.scope["enterprise_account_id"].as_string().in_(account_ids),
                    )
                )
            )
            await db.execute(
                delete(UserNotification).where(
                    or_(
                        UserNotification.recipient_account_id.in_(account_ids),
                        UserNotification.created_by_account_id.in_(account_ids),
                    )
                )
            )
            await db.execute(delete(Account).where(Account.id.in_(account_ids)))
        await db.commit()


async def _create_accounts(runtime: PostgresRuntime, *, label: str) -> tuple[CreatedAccount, int]:
    suffix = uuid4().hex[:10]
    enterprise = Account(
        id=str(uuid4()),
        email=f"tanaw-idempotency-pg-enterprise-{label}-{suffix}@example.com",
        password_hash="unused-test-password-hash",
        role=AccountRole.ENTERPRISE,
        display_name=f"Idempotency Enterprise {label}",
        title="Enterprise Account",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
        password_changed_at=datetime.now(UTC),
        enterprise_profile=EnterpriseProfile(
            enterprise_id=f"idempotency-enterprise-{label}-{suffix}",
            enterprise_name=f"Idempotency Enterprise {label}",
            category="business",
            manager_name=f"Manager {label}",
            barangay="Poblacion",
        ),
    )
    staff = Account(
        id=str(uuid4()),
        email=f"tanaw-idempotency-pg-staff-{label}-{suffix}@example.com",
        password_hash="unused-test-password-hash",
        role=AccountRole.STAFF,
        display_name=f"Idempotency Staff {label}",
        title="LGU Staff",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
        password_changed_at=datetime.now(UTC),
    )
    async with runtime.sessions() as db:
        db.add_all([enterprise, staff])
        await db.commit()
        staff_count = int(
            await db.scalar(
                select(func.count())
                .select_from(Account)
                .where(
                    Account.role == AccountRole.STAFF,
                    Account.status == AccountStatus.ACTIVE,
                    Account.activated_at.is_not(None),
                )
            )
            or 0
        )
    return CreatedAccount(id=enterprise.id, email=enterprise.email), staff_count


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


def _authorization(account: CreatedAccount) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(account.id)}"}


def _submission(
    submission_id: str,
    *,
    status: str = "Submitted",
    entries: int = 12,
    notes: str | None = None,
) -> dict[str, object]:
    unique_count = 6
    return {
        "submissionId": submission_id,
        "reportId": "REP-IDEMPOTENT-001",
        "period": "June 2026",
        "submittedAt": "2026-07-02T08:00:00Z",
        "entries": entries,
        "exits": 7,
        "peakOccupancy": 5,
        "uniqueCount": unique_count,
        "notes": notes,
        "syncStatus": "pending_cloud_sync",
        "payload": {
            "status": status,
            "demo": {
                "thisProvMale": str(unique_count),
                "thisProvFemale": "0",
                "otherProvMale": "0",
                "otherProvFemale": "0",
                "foreignMale": "0",
                "foreignFemale": "0",
            },
            "metrics": {
                "entries": entries,
                "exits": 7,
                "peak": 5,
                "unique": unique_count,
            },
        },
    }


async def _post_submission(
    client: AsyncClient,
    enterprise: CreatedAccount,
    payload: dict[str, object],
) -> Response:
    return await client.post(
        "/operational/desktop/report-submissions",
        headers=_authorization(enterprise),
        json=payload,
    )


async def _report_id(runtime: PostgresRuntime, enterprise_id: str) -> str:
    async with runtime.sessions() as db:
        report_id = await db.scalar(
            select(EnterpriseReportSubmission.id).where(
                EnterpriseReportSubmission.enterprise_profile_id == enterprise_id
            )
        )
    assert report_id is not None
    return report_id


async def _side_effect_counts(
    runtime: PostgresRuntime,
    enterprise_id: str,
    report_id: str,
) -> SideEffectCounts:
    async with runtime.sessions() as db:
        return SideEffectCounts(
            operations=int(
                await db.scalar(
                    select(func.count())
                    .select_from(ReportSubmissionOperation)
                    .where(ReportSubmissionOperation.enterprise_profile_id == enterprise_id)
                )
                or 0
            ),
            activities=int(
                await db.scalar(
                    select(func.count())
                    .select_from(ActivityLog)
                    .where(ActivityLog.source_id == report_id)
                )
                or 0
            ),
            notifications=int(
                await db.scalar(
                    select(func.count())
                    .select_from(UserNotification)
                    .where(UserNotification.source_id == report_id)
                )
                or 0
            ),
            report_events=int(
                await db.scalar(
                    select(func.count())
                    .select_from(RealtimeOutbox)
                    .where(RealtimeOutbox.payload["report_id"].as_string() == report_id)
                )
                or 0
            ),
            activity_events=int(
                await db.scalar(
                    select(func.count())
                    .select_from(RealtimeOutbox)
                    .where(
                        RealtimeOutbox.event_type == "activity.created",
                        RealtimeOutbox.payload["source_id"].as_string() == report_id,
                    )
                )
                or 0
            ),
            notification_events=int(
                await db.scalar(
                    select(func.count())
                    .select_from(RealtimeOutbox)
                    .where(
                        RealtimeOutbox.event_type == "notification.created",
                        RealtimeOutbox.payload["source_id"].as_string() == report_id,
                    )
                )
                or 0
            ),
        )


@pytest.mark.asyncio
async def test_successful_retry_replays_without_duplicate_side_effects(
    postgres_runtime: PostgresRuntime,
) -> None:
    enterprise, staff_count = await _create_accounts(postgres_runtime, label="retry")
    application = _create_test_app(postgres_runtime)
    payload = _submission(str(uuid4()))

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        first = await _post_submission(client, enterprise, payload)
        assert first.status_code == 202
        report_id = first.json()["id"]
        first_counts = await _side_effect_counts(postgres_runtime, enterprise.id, report_id)

        replay = await _post_submission(client, enterprise, payload)
        assert replay.status_code == 202
        assert replay.json() == first.json()

    assert first_counts == SideEffectCounts(1, 1, staff_count, 1, 1, staff_count)
    assert await _side_effect_counts(postgres_runtime, enterprise.id, report_id) == first_counts


@pytest.mark.asyncio
async def test_concurrent_identical_submissions_are_processed_once(
    postgres_runtime: PostgresRuntime,
) -> None:
    enterprise, staff_count = await _create_accounts(postgres_runtime, label="concurrent")
    application = _create_test_app(postgres_runtime)
    payload = _submission(str(uuid4()))

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        responses = await asyncio.gather(
            _post_submission(client, enterprise, payload),
            _post_submission(client, enterprise, payload),
        )

    assert [response.status_code for response in responses] == [202, 202]
    assert responses[0].json() == responses[1].json()
    report_id = responses[0].json()["id"]
    assert await _side_effect_counts(
        postgres_runtime, enterprise.id, report_id
    ) == SideEffectCounts(1, 1, staff_count, 1, 1, staff_count)


@pytest.mark.asyncio
async def test_rolled_back_submission_identity_can_be_retried(
    postgres_runtime: PostgresRuntime,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    enterprise, staff_count = await _create_accounts(postgres_runtime, label="rollback")
    application = _create_test_app(postgres_runtime)
    payload = _submission(str(uuid4()))
    original_notify = reporting_router.notify_staff_report_submission
    attempts = 0

    async def fail_once(db: AsyncSession, actor: Account, report: IntakeReportSummary) -> None:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("simulated side-effect failure")
        await original_notify(db, actor, report)

    monkeypatch.setattr(reporting_router, "notify_staff_report_submission", fail_once)

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        with pytest.raises(RuntimeError, match="simulated side-effect failure"):
            await _post_submission(client, enterprise, payload)
        retried = await _post_submission(client, enterprise, payload)
        assert retried.status_code == 202

    report_id = await _report_id(postgres_runtime, enterprise.id)
    assert await _side_effect_counts(
        postgres_runtime, enterprise.id, report_id
    ) == SideEffectCounts(1, 1, staff_count, 1, 1, staff_count)


@pytest.mark.asyncio
async def test_resubmission_uses_a_new_identity_and_its_retry_is_idempotent(
    postgres_runtime: PostgresRuntime,
) -> None:
    enterprise, _ = await _create_accounts(postgres_runtime, label="revision")
    application = _create_test_app(postgres_runtime)
    first_payload = _submission(str(uuid4()))

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        first = await _post_submission(client, enterprise, first_payload)
        assert first.status_code == 202
        report_id = first.json()["id"]

        async with postgres_runtime.sessions() as db:
            returned = await update_report_status(
                db,
                report_id,
                ReportStatusUpdate(status="Returned", remarks="Revise the totals."),
            )
            assert returned is not None
            await db.commit()

        revised_payload = _submission(
            str(uuid4()), status="Resubmitted", entries=14, notes="Corrected revision"
        )
        revised_payload["submittedAt"] = "2026-07-03T08:00:00Z"
        revised = await _post_submission(client, enterprise, revised_payload)
        assert revised.status_code == 202
        assert revised.json()["metrics"]["entry"] == 14
        revised_counts = await _side_effect_counts(postgres_runtime, enterprise.id, report_id)

        replay = await _post_submission(client, enterprise, revised_payload)
        assert replay.status_code == 202
        assert replay.json() == revised.json()

    assert revised_counts.operations == 2
    assert revised_counts.activities == 2
    assert await _side_effect_counts(postgres_runtime, enterprise.id, report_id) == revised_counts


@pytest.mark.asyncio
async def test_different_invalid_submission_still_conflicts_and_does_not_consume_identity(
    postgres_runtime: PostgresRuntime,
) -> None:
    enterprise, _ = await _create_accounts(postgres_runtime, label="workflow-conflict")
    application = _create_test_app(postgres_runtime)
    first_payload = _submission(str(uuid4()))
    invalid_payload = _submission(str(uuid4()), status="Resubmitted", entries=14)

    async with AsyncClient(
        transport=ASGITransport(app=application), base_url="http://test"
    ) as client:
        first = await _post_submission(client, enterprise, first_payload)
        assert first.status_code == 202
        invalid = await _post_submission(client, enterprise, invalid_payload)
        assert invalid.status_code == 409
        assert "cannot be changed" in invalid.json()["detail"].lower()

        changed_replay = dict(first_payload)
        changed_replay["notes"] = "Different data with a reused identity"
        identity_conflict = await _post_submission(client, enterprise, changed_replay)
        assert identity_conflict.status_code == 409
        assert "different request data" in identity_conflict.json()["detail"]

    report_id = first.json()["id"]
    counts = await _side_effect_counts(postgres_runtime, enterprise.id, report_id)
    assert counts.operations == 1
    assert counts.activities == 1
