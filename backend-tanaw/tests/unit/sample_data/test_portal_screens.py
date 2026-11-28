"""The sample dataset fills the Admin and Staff portal screens the way live data would."""

import json
import random
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.features.accounts.models import Account, AccountRole, AccountStatus, EnterpriseProfile
from app.features.activity_logs.models import ActivityLog
from app.features.monitoring.models import EnterpriseTelemetrySnapshot, OperationalAlert
from app.features.monitoring.schemas import DesktopCameraMonitoringSummary
from app.features.reporting.models import EnterpriseReportSubmission
from app.features.requests.models import Request, RequestMessage
from app.features.sample_data.activity import create_request_and_user_activity
from app.features.sample_data.definitions import REPORTING_STAFF_NAME
from app.features.sample_data.report_workflow import create_activity_logs
from app.features.sample_data.visitors import (
    PARTIAL_CAMERA_ENTERPRISE_INDEX,
    create_admin_visitor_history,
    sample_camera_monitoring,
)

GENERATED_AT = datetime(2026, 11, 24, 6, tzinfo=UTC)


def test_camera_summaries_name_each_camera_and_one_stops_reporting() -> None:
    outage_since = datetime(2026, 11, 24, 13, 10, tzinfo=UTC)
    healthy = DesktopCameraMonitoringSummary.model_validate(
        sample_camera_monitoring(1, outage_since + timedelta(hours=1), outage_since)
    )
    before = DesktopCameraMonitoringSummary.model_validate(
        sample_camera_monitoring(
            PARTIAL_CAMERA_ENTERPRISE_INDEX, outage_since - timedelta(minutes=1), outage_since
        )
    )
    during = DesktopCameraMonitoringSummary.model_validate(
        sample_camera_monitoring(PARTIAL_CAMERA_ENTERPRISE_INDEX, outage_since, outage_since)
    )

    assert healthy.status == "running"
    assert [camera.cameraName for camera in healthy.cameras] == [
        "Main Entrance",
        "Side Entrance",
        "Parking Area",
    ]
    assert before.status == "running"
    assert during.status == "partial"
    assert during.errorCameraCount == 1
    assert during.healthyCameraCount == len(during.cameras) - 1
    failing = next(camera for camera in during.cameras if camera.status == "error")
    assert failing.cameraName == "Main Entrance"
    assert failing.error == "No visitor counts since 1:10 PM."


@pytest.mark.asyncio
async def test_latest_telemetry_carries_the_camera_summary() -> None:
    enterprises = [_enterprise(index) for index in range(5)]
    db = MagicMock()
    db.flush = AsyncMock()

    scenario = await create_admin_visitor_history(
        db, GENERATED_AT, "full-workflow", random.Random("cameras"), enterprises, enterprises[0]
    )

    latest: dict[str, EnterpriseTelemetrySnapshot] = {}
    for snapshot in scenario.telemetry:
        current = latest.get(snapshot.enterprise_profile_id)
        if current is None or snapshot.captured_at > current.captured_at:
            latest[snapshot.enterprise_profile_id] = snapshot
    statuses = {
        account_id: json.loads(snapshot.payload_json or "{}")["monitoring"]["status"]
        for account_id, snapshot in latest.items()
    }
    assert statuses[enterprises[PARTIAL_CAMERA_ENTERPRISE_INDEX].id] == "partial"
    assert statuses[enterprises[1].id] == "running"


@pytest.mark.asyncio
async def test_report_logs_follow_the_live_workflow_and_link_to_the_report() -> None:
    waiting = _report("waiting", "Pending Review", datetime(2026, 11, 4, 2, tzinfo=UTC))
    accepted = _report("accepted", "Ready to Consolidate", datetime(2026, 11, 5, 2, tzinfo=UTC))
    consolidated = _report("consolidated", "Consolidated", datetime(2026, 11, 6, 2, tzinfo=UTC))
    db = MagicMock()
    db.flush = AsyncMock()

    count = await create_activity_logs(
        db, {"reports": [waiting, accepted, consolidated]}, [], GENERATED_AT
    )

    logs: list[ActivityLog] = db.add_all.call_args.args[0]
    assert count == len(logs)
    by_report: dict[str, list[str]] = {}
    for log in sorted(logs, key=lambda item: item.timestamp):
        by_report.setdefault(log.source_id or "", []).append(log.action)
    assert by_report == {
        "waiting-id": ["Submit Enterprise Report"],
        "accepted-id": ["Submit Enterprise Report", "Report Ready to Consolidate"],
        "consolidated-id": ["Submit Enterprise Report", "Report Ready to Consolidate"],
    }
    review = next(
        log
        for log in logs
        if log.action == "Report Ready to Consolidate" and log.source_id == "accepted-id"
    )
    assert review.actor == REPORTING_STAFF_NAME
    assert review.activity_group == "Reports"
    assert review.severity == "Success"
    assert all(log.timestamp <= GENERATED_AT for log in logs)


@pytest.mark.asyncio
async def test_request_history_gives_resolved_open_and_approved_requests() -> None:
    lgu = [_lgu(AccountRole.ADMIN), _lgu(AccountRole.IT), _lgu(AccountRole.STAFF)]
    enterprises = [_enterprise(index) for index in range(9)]
    db = MagicMock()
    db.flush = AsyncMock()

    counts = await create_request_and_user_activity(db, lgu, enterprises, GENERATED_AT)

    added = [call.args[0] for call in db.add.call_args_list]
    batches = [item for call in db.add_all.call_args_list for item in call.args[0]]
    logs = [item for item in batches if isinstance(item, ActivityLog)]
    requests = [item for item in batches if isinstance(item, Request)]
    messages = [item for item in batches if isinstance(item, RequestMessage)]
    alerts = [item for item in added if isinstance(item, OperationalAlert)]
    assert {(request.request_group, request.status) for request in requests} == {
        ("Desktop app or camera problem", "Resolved"),
        ("Other", "In Progress"),
        ("Account change", "Approved"),
    }
    assert [(alert.alert_type, alert.status) for alert in alerts] == [
        ("Busier Than Usual", "Ended")
    ]
    assert {message.kind for message in messages} == {"status", "message"}
    assert counts == {"operationalAlerts": 1, "requests": 3, "activityLogs": len(logs)}

    actions = {log.action for log in logs}
    assert {
        "Send Request",
        "Request Account Change",
        "Request Resolved",
        "Approve Account Change",
        "Busier Than Usual",
        "Back to Usual",
        "Account Locked",
        "Login",
        "Logout",
        "Password Changed",
        "Create Enterprise Account",
        "Update Enterprise Account",
    } <= actions
    assert {log.activity_group for log in logs} == {
        "Requests",
        "Accounts",
        "Enterprises",
        "Monitoring",
        "Login & Security",
    }
    assert {log.action for log in logs if log.activity_group == "Enterprises"} == {
        "Create Enterprise Account",
        "Update Enterprise Account",
    }
    sign_ins = [log for log in logs if log.action == "Login"]
    assert all(log.ip_address and log.user_agent and log.session_id for log in sign_ins)
    # Closed requests name the IT person who handled them; the open one is not picked up.
    handlers = {request.status: request.handled_by_account_id for request in requests}
    assert handlers == {"Resolved": "it-account", "Approved": "it-account", "In Progress": None}
    assert all(log.timestamp <= GENERATED_AT for log in logs)
    logins = [log for log in logs if log.action == "Login"]
    assert {log.source_id for log in logins} == {account.id for account in lgu}


def _lgu(role: AccountRole) -> Account:
    return Account(
        id=f"{role.value}-account",
        email=f"{role.value}@example.com",
        password_hash="hash",
        role=role,
        display_name=f"{role.value.title()} User",
        title=role.value,
        status=AccountStatus.ACTIVE,
    )


def _enterprise(index: int) -> Account:
    account = Account(
        id=f"enterprise-{index}",
        email=f"enterprise-{index}@example.com",
        password_hash="hash",
        role=AccountRole.ENTERPRISE,
        display_name=f"Enterprise {index}",
        title="Enterprise Account",
        status=AccountStatus.ACTIVE,
        created_at=GENERATED_AT - timedelta(days=400 + index),
    )
    account.enterprise_profile = EnterpriseProfile(
        account_id=account.id,
        enterprise_id=f"ENT-{index}",
        enterprise_name=f"Enterprise {index}",
        attraction_code="411",
        manager_name="Test Manager",
        barangay="Nueva",
        building_capacity=250,
    )
    return account


def _report(name: str, review_status: str, submitted_at: datetime) -> EnterpriseReportSubmission:
    enterprise = _enterprise(1)
    report = EnterpriseReportSubmission(
        id=f"{name}-id",
        report_id=f"REP-{name.upper()}",
        enterprise_profile_id=enterprise.id,
        enterprise_name="Enterprise 1",
        attraction_code="411",
        barangay="Nueva",
        period="October 2026",
        month="October",
        submitted_at=submitted_at,
        unique_count=80,
        status="Submitted",
        review_status=review_status,
        payload_json=json.dumps({"status": "Submitted"}),
    )
    report.enterprise_profile = enterprise.enterprise_profile  # type: ignore[assignment]
    return report
