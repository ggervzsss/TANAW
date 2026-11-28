"""An enterprise reads back its own reports, with where each stands in the staff review."""

import copy
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient, Response
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
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
from app.features.reporting.counting import snapshot_digest
from app.features.reporting.models import (
    EnterpriseReportSubmission,
    FinalReport,
    ReportSubmissionOperation,
)
from tests.support.counting import counting_snapshot
from tests.support.postgres import PostgresRuntime, open_postgres_runtime

TEST_EMAIL_PATTERN = "tanaw-desktop-reports-pg-%@example.com"
TEST_PREPARED_BY = "Desktop Reports PG"


@dataclass(frozen=True)
class CreatedAccount:
    id: str
    display_name: str
    enterprise_key: str | None = None
    enterprise_name: str | None = None


@pytest_asyncio.fixture
async def postgres_runtime(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[PostgresRuntime]:
    async with open_postgres_runtime(
        _clean_rows,
        jwt_secret_key="tanaw-desktop-reports-jwt-secret-1234567890",
    ) as runtime:
        settings = runtime.settings
        monkeypatch.setattr(security, "get_settings", lambda: settings)
        yield runtime


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
        final_ids = list(
            await db.scalars(
                select(FinalReport.id).where(FinalReport.prepared_by == TEST_PREPARED_BY)
            )
        )
        outbox_conditions = []
        if intake_ids or final_ids:
            outbox_conditions.extend(
                [
                    RealtimeOutbox.payload["report_id"].as_string().in_([*intake_ids, *final_ids]),
                    RealtimeOutbox.payload["source_id"].as_string().in_(intake_ids),
                ]
            )
        if account_ids:
            outbox_conditions.extend(
                [
                    RealtimeOutbox.scope["recipient_account_id"].as_string().in_(account_ids),
                    RealtimeOutbox.scope["enterprise_account_id"].as_string().in_(account_ids),
                    RealtimeOutbox.payload["account_id"].as_string().in_(account_ids),
                ]
            )
        if outbox_conditions:
            await db.execute(delete(RealtimeOutbox).where(or_(*outbox_conditions)))
        if final_ids:
            await db.execute(delete(FinalReport).where(FinalReport.id.in_(final_ids)))
        if intake_ids:
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
                delete(UserNotification).where(
                    or_(
                        UserNotification.recipient_account_id.in_(account_ids),
                        UserNotification.created_by_account_id.in_(account_ids),
                    )
                )
            )
            await db.execute(delete(Account).where(Account.id.in_(account_ids)))
        await db.commit()


async def _create_account(
    runtime: PostgresRuntime, role: AccountRole, *, label: str
) -> CreatedAccount:
    suffix = uuid4().hex[:10]
    name = f"Desktop {role.value.title()} {label}"
    account = Account(
        id=str(uuid4()),
        email=f"tanaw-desktop-reports-pg-{role.value}-{label}-{suffix}@example.com",
        password_hash="unused-test-password-hash",
        role=role,
        display_name=name,
        title=role.value,
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
        password_changed_at=datetime.now(UTC),
        enterprise_profile=(
            EnterpriseProfile(
                enterprise_id=f"desktop-reports-{label}-{suffix}",
                enterprise_name=name,
                attraction_code="411",
                manager_name=f"Manager {label}",
                barangay="Poblacion",
            )
            if role == AccountRole.ENTERPRISE
            else None
        ),
    )
    async with runtime.sessions() as db:
        db.add(account)
        await db.commit()
    profile = account.enterprise_profile
    return CreatedAccount(
        id=account.id,
        display_name=name,
        enterprise_key=profile.enterprise_id if profile else None,
        enterprise_name=profile.enterprise_name if profile else None,
    )


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
    *,
    report_id: str = "REP-DESKTOP-001",
    period: str = "June 2026",
    submitted_at: str = "2026-07-02T08:00:00Z",
    entries: int = 12,
    submission_id: str | None = None,
) -> dict[str, Any]:
    unique_count = 6
    return {
        "submissionId": submission_id or str(uuid4()),
        "reportId": report_id,
        "period": period,
        "submittedAt": submitted_at,
        "entries": entries,
        "exits": 7,
        "peakOccupancy": 5,
        "uniqueCount": unique_count,
        "notes": None,
        "syncStatus": "pending_cloud_sync",
        "payload": {
            "counting": counting_snapshot(period, entries=entries, exits=7, peak=5, unique=6),
            "status": "Submitted",
            "demo": {
                "thisProvMale": str(unique_count),
                "thisProvFemale": "0",
                "otherProvMale": "0",
                "otherProvFemale": "0",
                "foreignMale": "0",
                "foreignFemale": "0",
            },
            "metrics": {"entries": entries, "exits": 7, "peak": 5, "unique": unique_count},
        },
    }


async def _submit(
    client: AsyncClient, enterprise: CreatedAccount, payload: dict[str, Any]
) -> Response:
    payload = copy.deepcopy(payload)
    snapshot = payload["payload"]["counting"]
    snapshot["enterprise_id"] = enterprise.enterprise_key
    snapshot["snapshot_version"] = snapshot_digest(snapshot)
    return await client.post(
        "/operational/desktop/report-submissions",
        headers=_authorization(enterprise),
        json=payload,
    )


async def _accept(client: AsyncClient, actor: CreatedAccount, report_id: str) -> Response:
    return await client.patch(
        f"/operational/reports/intake/{report_id}/status",
        headers=_authorization(actor),
        json={"status": "Ready to Consolidate"},
    )


def _client(runtime: PostgresRuntime) -> AsyncClient:
    return AsyncClient(
        transport=ASGITransport(app=_create_test_app(runtime)), base_url="http://test"
    )


@pytest.mark.asyncio
async def test_enterprises_list_only_their_own_reports_newest_first(
    postgres_runtime: PostgresRuntime,
) -> None:
    enterprise = await _create_account(postgres_runtime, AccountRole.ENTERPRISE, label="own")
    other = await _create_account(postgres_runtime, AccountRole.ENTERPRISE, label="own-other")
    staff = await _create_account(postgres_runtime, AccountRole.STAFF, label="own")

    async with _client(postgres_runtime) as client:
        june = (await _submit(client, enterprise, _submission())).json()
        july = (
            await _submit(
                client,
                enterprise,
                _submission(
                    report_id="REP-DESKTOP-002",
                    period="July 2026",
                    submitted_at="2026-08-03T08:00:00Z",
                ),
            )
        ).json()
        others = (await _submit(client, other, _submission(report_id="REP-OTHER"))).json()
        assert (await _accept(client, staff, june["id"])).status_code == 200

        listed = await client.get(
            "/operational/desktop/report-submissions", headers=_authorization(enterprise)
        )
        june_only = await client.get(
            "/operational/desktop/report-submissions",
            headers=_authorization(enterprise),
            params={"period": "June 2026"},
        )
        other_listed = await client.get(
            "/operational/desktop/report-submissions", headers=_authorization(other)
        )
        staff_listed = await client.get(
            "/operational/desktop/report-submissions", headers=_authorization(staff)
        )

    assert listed.status_code == 200
    assert [report["id"] for report in listed.json()] == [july["id"], june["id"]]
    assert [report["status"] for report in listed.json()] == [
        "Pending Review",
        "Ready to Consolidate",
    ]
    assert [report["id"] for report in june_only.json()] == [june["id"]]
    assert [report["id"] for report in other_listed.json()] == [others["id"]]
    assert staff_listed.status_code == 403
