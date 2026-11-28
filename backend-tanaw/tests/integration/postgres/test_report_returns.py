"""Staff return a submitted report for correction, and the enterprise sends a new version."""

import asyncio
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
from sqlalchemy import delete, func, or_, select
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
from app.features.notifications.service import (
    ENTERPRISE_REPORT_RETURNED_NOTIFICATION,
    STAFF_REPORT_SUBMITTED_NOTIFICATION,
)
from app.features.realtime.models import RealtimeOutbox
from app.features.reporting import router as reporting_router
from app.features.reporting.counting import snapshot_digest
from app.features.reporting.errors import InvalidReportWorkflowError
from app.features.reporting.final_reports import create_final_report
from app.features.reporting.models import (
    EnterpriseReportSubmission,
    FinalReport,
    ReportSubmissionOperation,
)
from app.features.reporting.policies import RETURN_REPORT_ACTION
from app.features.reporting.schemas import FinalReportCreate
from tests.support.counting import counting_snapshot
from tests.support.postgres import PostgresRuntime, open_postgres_runtime

TEST_EMAIL_PATTERN = "tanaw-report-return-pg-%@example.com"
TEST_PREPARED_BY = "Report Return PG"
REASON = "The visitor origins do not add up to the unique visitors. Please recount them."


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
        jwt_secret_key="tanaw-report-return-jwt-secret-1234567890",
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
    name = f"Return {role.value.title()} {label}"
    account = Account(
        id=str(uuid4()),
        email=f"tanaw-report-return-pg-{role.value}-{label}-{suffix}@example.com",
        password_hash="unused-test-password-hash",
        role=role,
        display_name=name,
        title=role.value,
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
        password_changed_at=datetime.now(UTC),
        enterprise_profile=(
            EnterpriseProfile(
                enterprise_id=f"report-return-{label}-{suffix}",
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
    report_id: str = "REP-RETURN-001",
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


async def _return(
    client: AsyncClient, actor: CreatedAccount, report_id: str, reason: str = REASON
) -> Response:
    return await client.post(
        f"/operational/reports/intake/{report_id}/return",
        headers=_authorization(actor),
        json={"reason": reason},
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
async def test_returning_a_report_notifies_the_enterprise_and_logs_the_reason(
    postgres_runtime: PostgresRuntime,
) -> None:
    enterprise = await _create_account(postgres_runtime, AccountRole.ENTERPRISE, label="notify")
    staff = await _create_account(postgres_runtime, AccountRole.STAFF, label="notify")

    async with _client(postgres_runtime) as client:
        submitted = await _submit(client, enterprise, _submission())
        assert submitted.status_code == 202
        report_id = submitted.json()["id"]
        assert submitted.json()["version"] == 1
        assert submitted.json()["previousVersionId"] is None
        assert submitted.json()["returnedReason"] is None

        returned = await _return(client, staff, report_id, f"  {REASON}  ")

    assert returned.status_code == 200
    body = returned.json()
    assert body["id"] == report_id
    assert body["status"] == "Returned"
    assert body["returnedReason"] == REASON
    assert body["returnedBy"] == staff.display_name
    assert body["returnedAt"] is not None
    assert body["version"] == 1

    async with postgres_runtime.sessions() as db:
        notification = await db.scalar(
            select(UserNotification).where(
                UserNotification.recipient_account_id == enterprise.id,
                UserNotification.notification_type == ENTERPRISE_REPORT_RETURNED_NOTIFICATION,
            )
        )
        assert notification is not None
        assert (
            notification.message == f"Your June 2026 report was returned for correction: {REASON}"
        )
        assert notification.severity == "Warning"
        assert notification.source_type == "enterprise.report"
        assert notification.source_id == report_id
        assert notification.created_by_name == staff.display_name

        log = await db.scalar(
            select(ActivityLog).where(
                ActivityLog.source_id == report_id, ActivityLog.action == RETURN_REPORT_ACTION
            )
        )
        assert log is not None
        assert log.activity_group == "Reports"
        assert log.actor == staff.display_name
        assert log.actor_role == "LGU Staff"
        assert log.summary == (
            f"{staff.display_name} returned REP-RETURN-001 from {enterprise.enterprise_name} "
            f"for June 2026: {REASON}"
        )

        # The enterprise's desktop hears about it through the realtime events it already follows.
        notification_event = await db.scalar(
            select(RealtimeOutbox).where(
                RealtimeOutbox.event_type == "notification.created",
                RealtimeOutbox.payload["notification_id"].as_string() == notification.id,
            )
        )
        assert notification_event is not None
        assert notification_event.scope["recipient_account_id"] == enterprise.id
        assert notification_event.audience_roles == [AccountRole.ENTERPRISE.value]
        report_events = list(
            await db.scalars(
                select(RealtimeOutbox).where(
                    RealtimeOutbox.event_type == "report.updated",
                    RealtimeOutbox.payload["report_id"].as_string() == report_id,
                )
            )
        )
        assert [event.payload["review_status"] for event in report_events] == ["Returned"]
        assert report_events[0].scope["enterprise_account_id"] == enterprise.id


@pytest.mark.asyncio
async def test_only_waiting_or_accepted_reports_can_be_returned(
    postgres_runtime: PostgresRuntime,
) -> None:
    enterprise = await _create_account(postgres_runtime, AccountRole.ENTERPRISE, label="rules")
    other = await _create_account(postgres_runtime, AccountRole.ENTERPRISE, label="rules-other")
    staff = await _create_account(postgres_runtime, AccountRole.STAFF, label="rules")
    admin = await _create_account(postgres_runtime, AccountRole.ADMIN, label="rules")
    it = await _create_account(postgres_runtime, AccountRole.IT, label="rules")

    async with _client(postgres_runtime) as client:
        accepted = (await _submit(client, enterprise, _submission())).json()
        assert (await _accept(client, staff, accepted["id"])).status_code == 200

        for actor in (enterprise, it):
            forbidden = await _return(client, actor, accepted["id"])
            assert forbidden.status_code == 403

        for reason in ["Too short", " " * 4 + "x" * 9 + " " * 4, "x" * 501]:
            invalid = await _return(client, staff, accepted["id"], reason)
            assert invalid.status_code == 422

        not_a_status = await client.patch(
            f"/operational/reports/intake/{accepted['id']}/status",
            headers=_authorization(staff),
            json={"status": "Returned"},
        )
        assert not_a_status.status_code == 409

        # An Admin can return an accepted report too.
        returned = await _return(client, admin, accepted["id"])
        assert returned.status_code == 200
        assert returned.json()["returnedBy"] == admin.display_name

        again = await _return(client, staff, accepted["id"])
        assert again.status_code == 409
        assert "already returned" in again.json()["detail"]

        cannot_accept = await _accept(client, staff, accepted["id"])
        assert cannot_accept.status_code == 409

        missing = await _return(client, staff, str(uuid4()))
        assert missing.status_code == 404

        consolidated = (await _submit(client, other, _submission(report_id="REP-OTHER"))).json()
        assert (await _accept(client, staff, consolidated["id"])).status_code == 200

    async with postgres_runtime.sessions() as db:
        final = await create_final_report(
            db, FinalReportCreate(reportIds=[consolidated["id"]], preparedBy=TEST_PREPARED_BY)
        )
        assert final is not None
        await db.commit()

    async with _client(postgres_runtime) as client:
        too_late = await _return(client, staff, consolidated["id"])
    assert too_late.status_code == 409
    assert "consolidated report" in too_late.json()["detail"]


@pytest.mark.asyncio
async def test_a_returned_report_is_replaced_by_the_next_version(
    postgres_runtime: PostgresRuntime,
) -> None:
    enterprise = await _create_account(postgres_runtime, AccountRole.ENTERPRISE, label="versions")
    staff = await _create_account(postgres_runtime, AccountRole.STAFF, label="versions")

    async with _client(postgres_runtime) as client:
        first = (await _submit(client, enterprise, _submission())).json()
        not_yet = await _submit(
            client, enterprise, _submission(submitted_at="2026-07-03T08:00:00Z", entries=14)
        )
        assert not_yet.status_code == 409
        assert "one report per reporting month" in not_yet.json()["detail"]

        assert (await _return(client, staff, first["id"])).status_code == 200
        second_response = await _submit(
            client, enterprise, _submission(submitted_at="2026-07-04T08:00:00Z", entries=14)
        )
        assert second_response.status_code == 202
        second = second_response.json()
        assert second["version"] == 2
        assert second["previousVersionId"] == first["id"]
        assert second["code"] == "REP-RETURN-001-v2"
        assert second["status"] == "Pending Review"
        assert second["returnedReason"] is None
        assert second["metrics"]["entry"] == 14

        # The corrected version waits for staff like any report; a third one still conflicts.
        conflict = await _submit(
            client, enterprise, _submission(submitted_at="2026-07-05T08:00:00Z", entries=15)
        )
        assert conflict.status_code == 409
        assert (await _return(client, staff, second["id"])).status_code == 200

        third_response = await _submit(
            client,
            enterprise,
            _submission(
                report_id="REP-RETURN-001-v2", submitted_at="2026-07-06T08:00:00Z", entries=16
            ),
        )
        assert third_response.status_code == 202
        third = third_response.json()
        assert (third["version"], third["code"]) == (3, "REP-RETURN-001-v3")
        assert third["previousVersionId"] == second["id"]
        assert (await _accept(client, staff, third["id"])).status_code == 200

        staff_list = await client.get("/operational/reports/intake", headers=_authorization(staff))
        own = await client.get(
            "/operational/desktop/report-submissions",
            headers=_authorization(enterprise),
            params={"period": "June 2026"},
        )

    assert staff_list.status_code == 200
    versions = [
        (report["version"], report["status"])
        for report in staff_list.json()
        if report["enterpriseId"] == enterprise.enterprise_key
    ]
    assert versions == [(3, "Ready to Consolidate"), (2, "Returned"), (1, "Returned")]
    assert [report["id"] for report in own.json()] == [third["id"], second["id"], first["id"]]

    async with postgres_runtime.sessions() as db:
        corrected_notice = await db.scalar(
            select(UserNotification.message).where(
                UserNotification.source_id == second["id"],
                UserNotification.notification_type == STAFF_REPORT_SUBMITTED_NOTIFICATION,
            )
        )
        assert corrected_notice is not None
        assert "sent a corrected report, REP-RETURN-001-v2 (version 2)" in corrected_notice


@pytest.mark.asyncio
async def test_concurrent_corrected_versions_accept_exactly_one(
    postgres_runtime: PostgresRuntime,
) -> None:
    enterprise = await _create_account(postgres_runtime, AccountRole.ENTERPRISE, label="race")
    staff = await _create_account(postgres_runtime, AccountRole.STAFF, label="race")

    async with _client(postgres_runtime) as client:
        first = (await _submit(client, enterprise, _submission())).json()
        assert (await _return(client, staff, first["id"])).status_code == 200
        responses = await asyncio.gather(
            _submit(client, enterprise, _submission(submitted_at="2026-07-04T08:00:00Z")),
            _submit(client, enterprise, _submission(submitted_at="2026-07-04T09:00:00Z")),
        )

    assert sorted(response.status_code for response in responses) == [202, 409]
    async with postgres_runtime.sessions() as db:
        statuses = list(
            await db.scalars(
                select(EnterpriseReportSubmission.review_status)
                .where(EnterpriseReportSubmission.enterprise_profile_id == enterprise.id)
                .order_by(EnterpriseReportSubmission.version)
            )
        )
    assert statuses == ["Returned", "Pending Review"]


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
                    report_id="REP-RETURN-002",
                    period="July 2026",
                    submitted_at="2026-08-03T08:00:00Z",
                ),
            )
        ).json()
        others = (await _submit(client, other, _submission(report_id="REP-OTHER"))).json()
        assert (await _return(client, staff, june["id"])).status_code == 200

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
    returned = listed.json()[1]
    assert (returned["status"], returned["returnedReason"]) == ("Returned", REASON)
    assert [report["id"] for report in june_only.json()] == [june["id"]]
    assert [report["id"] for report in other_listed.json()] == [others["id"]]
    assert staff_listed.status_code == 403


@pytest.mark.asyncio
async def test_consolidation_leaves_out_returned_versions(
    postgres_runtime: PostgresRuntime,
) -> None:
    enterprise = await _create_account(postgres_runtime, AccountRole.ENTERPRISE, label="final")
    other = await _create_account(postgres_runtime, AccountRole.ENTERPRISE, label="final-other")
    staff = await _create_account(postgres_runtime, AccountRole.STAFF, label="final")

    async with _client(postgres_runtime) as client:
        returned = (await _submit(client, enterprise, _submission(entries=12))).json()
        assert (await _accept(client, staff, returned["id"])).status_code == 200
        assert (await _return(client, staff, returned["id"])).status_code == 200
        corrected = (
            await _submit(
                client, enterprise, _submission(submitted_at="2026-07-04T08:00:00Z", entries=20)
            )
        ).json()
        assert (await _accept(client, staff, corrected["id"])).status_code == 200
        accepted = (await _submit(client, other, _submission(report_id="REP-OTHER"))).json()
        assert (await _accept(client, staff, accepted["id"])).status_code == 200

        rejected = await client.post(
            "/operational/reports/final",
            headers=_authorization(staff),
            json={"reportIds": [returned["id"], accepted["id"]], "preparedBy": TEST_PREPARED_BY},
        )
    assert rejected.status_code == 409
    assert "Ready to Consolidate" in rejected.json()["detail"]

    async with postgres_runtime.sessions() as db:
        with pytest.raises(InvalidReportWorkflowError):
            await create_final_report(
                db, FinalReportCreate(reportIds=[returned["id"]], preparedBy=TEST_PREPARED_BY)
            )
        await db.rollback()

    async with postgres_runtime.sessions() as db:
        final = await create_final_report(
            db,
            FinalReportCreate(
                reportIds=[corrected["id"], accepted["id"]], preparedBy=TEST_PREPARED_BY
            ),
        )
        assert final is not None
        await db.commit()
    assert {source.id for source in final.sources} == {corrected["id"], accepted["id"]}
    assert final.enterpriseCount == 2
    assert final.totalEntry == 32

    async with postgres_runtime.sessions() as db:
        stored = await db.get(EnterpriseReportSubmission, returned["id"])
        assert stored is not None
        assert stored.review_status == "Returned"


@pytest.mark.asyncio
async def test_replays_return_their_own_version_after_a_return(
    postgres_runtime: PostgresRuntime,
) -> None:
    enterprise = await _create_account(postgres_runtime, AccountRole.ENTERPRISE, label="replay")
    staff = await _create_account(postgres_runtime, AccountRole.STAFF, label="replay")
    first_payload = _submission()
    second_payload = _submission(submitted_at="2026-07-04T08:00:00Z", entries=14)

    async with _client(postgres_runtime) as client:
        first = await _submit(client, enterprise, first_payload)
        assert (await _return(client, staff, first.json()["id"])).status_code == 200

        # A retry of the first submission replays its original answer; it is not a correction.
        first_replay = await _submit(client, enterprise, first_payload)
        assert first_replay.status_code == 202
        assert first_replay.json() == first.json()

        second = await _submit(client, enterprise, second_payload)
        assert second.status_code == 202
        second_replay = await _submit(client, enterprise, second_payload)
        assert second_replay.status_code == 202
        assert second_replay.json() == second.json()
        assert second.json()["version"] == 2

    async with postgres_runtime.sessions() as db:
        versions = int(
            await db.scalar(
                select(func.count())
                .select_from(EnterpriseReportSubmission)
                .where(EnterpriseReportSubmission.enterprise_profile_id == enterprise.id)
            )
            or 0
        )
        operations = int(
            await db.scalar(
                select(func.count())
                .select_from(ReportSubmissionOperation)
                .where(ReportSubmissionOperation.enterprise_profile_id == enterprise.id)
            )
            or 0
        )
        submissions_logged = int(
            await db.scalar(
                select(func.count())
                .select_from(ActivityLog)
                .where(
                    ActivityLog.source_id.in_([first.json()["id"], second.json()["id"]]),
                    ActivityLog.action == "Submit Enterprise Report",
                )
            )
            or 0
        )
    assert (versions, operations, submissions_logged) == (2, 2, 2)
