import json
import random
from datetime import UTC, date, datetime
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest

from app.core.password_policy import validate_password_policy
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
)
from app.features.mail.models import EmailOutbox
from app.features.monitoring.models import OperationalAlert
from app.features.notifications.models import UserNotification
from app.features.notifications.service import (
    STAFF_REPORT_RESUBMITTED_NOTIFICATION,
    STAFF_REPORT_SUBMITTED_NOTIFICATION,
)
from app.features.reporting.models import EnterpriseReportSubmission
from app.features.reporting.schemas import DesktopReportSubmissionIngest
from app.features.requests.models import Request
from app.features.sample_data.daily_details import sample_report_details
from app.features.sample_data.dataset import prepared_counts
from app.features.sample_data.definitions import (
    ENTERPRISES,
    LGU_ACCOUNTS,
    REPORTING_STAFF_NAME,
    TEST_ACCOUNT_PASSWORD,
    AdminVisitorScenario,
)
from app.features.sample_data.helpers import (
    last_reported_day,
    sample_submitted_at,
    seeded_review_status,
    should_skip_target_report,
)
from app.features.sample_data.portal_workflow import create_portal_workflow_data
from app.features.sample_data.report_workflow import (
    create_final_reports,
    create_staff_report_notifications,
    prepare_staff_notification_reports,
)
from app.features.sample_data.visitors import create_admin_visitor_history


def test_sample_enterprises_match_configured_locations_and_contacts() -> None:
    expected_enterprises = (
        (
            "Balon ni Lolo Uweng",
            "901",
            "Ma Regine Javier",
            "Landayan",
            "Barangay Landayan, San Pedro, Laguna 4023",
            14.352361,
            121.067985,
            "balon.lolo.uweng@tanaw.test",
            "+639171110001",
        ),
        (
            "San Pedro Apostol Parish",
            "202",
            "Irish May Arabaca",
            "Nueva",
            "Barangay Nueva, San Pedro, Laguna 4023",
            14.363881,
            121.056564,
            "sanpedro.apostol@tanaw.test",
            "+639171110002",
        ),
        (
            "Lolo Uweng Pilgrim Church",
            "202",
            "David Kristian Vallejera",
            "Landayan",
            "Barangay Landayan, San Pedro, Laguna 4023",
            14.350951,
            121.066450,
            "lolo.uweng.church@tanaw.test",
            "+639171110003",
        ),
        (
            "Tricia's Bar & Lounge",
            "901",
            "Kenneth Delicano",
            "Nueva",
            "Barangay Nueva, San Pedro, Laguna 4023",
            14.348207,
            121.064359,
            "tricias.bar@tanaw.test",
            "+639171110004",
        ),
        (
            "Hallow Ridge Filipinas Golf Inc.",
            "401",
            "Sebastien Bercasio",
            "San Antonio",
            "Barangay San Antonio, San Pedro, Laguna 4023",
            14.357021,
            121.028243,
            "hallowridge.golf@tanaw.test",
            "+639171110005",
        ),
        (
            "Pacita Complex Mall",
            "501",
            "Andrea Villanueva",
            "Pacita I",
            "Barangay Pacita I, San Pedro, Laguna 4023",
            14.343053,
            121.060053,
            "pacita.complex@tanaw.test",
            "+639171110006",
        ),
        (
            "San Pedro Public Market",
            "502",
            "Ramon Dela Cruz",
            "Poblacion",
            "Barangay Poblacion, San Pedro, Laguna 4023",
            14.364497,
            121.059092,
            "public.market@tanaw.test",
            "+639171110007",
        ),
        (
            "Sampaguita Gardens",
            "411",
            "Liza Fernandez",
            "Sampaguita",
            "Barangay Sampaguita, San Pedro, Laguna 4023",
            14.346698,
            121.031807,
            "sampaguita.gardens@tanaw.test",
            "+639171110008",
        ),
        (
            "Riverside Sports Center",
            "405",
            "Jerome Santos",
            "Riverside",
            "Barangay Riverside, San Pedro, Laguna 4023",
            14.332135,
            121.027693,
            "riverside.sports@tanaw.test",
            "+639171110009",
        ),
    )

    assert (
        tuple(
            (
                enterprise.name,
                enterprise.attraction_code,
                enterprise.manager,
                enterprise.barangay,
                enterprise.address,
                enterprise.latitude,
                enterprise.longitude,
                enterprise.email,
                enterprise.phone,
            )
            for enterprise in ENTERPRISES
        )
        == expected_enterprises
    )
    assert len({enterprise.email for enterprise in ENTERPRISES}) == len(ENTERPRISES)
    assert len({enterprise.phone for enterprise in ENTERPRISES}) == len(ENTERPRISES)


def test_generated_account_content_has_no_mock_label() -> None:
    values = [TEST_ACCOUNT_PASSWORD, REPORTING_STAFF_NAME]
    for enterprise in ENTERPRISES:
        values.extend(
            [
                enterprise.name,
                enterprise.attraction_code,
                enterprise.manager,
                enterprise.barangay,
                enterprise.address,
                enterprise.email,
            ]
        )
    for email, _role, display_name, title, first_name, last_name in LGU_ACCOUNTS:
        values.extend([email, display_name, title, first_name, last_name])

    assert all("mock" not in value.lower() for value in values)
    assert validate_password_policy(TEST_ACCOUNT_PASSWORD) == TEST_ACCOUNT_PASSWORD


def test_target_enterprise_is_missing_for_four_completed_months_and_current_month() -> None:
    older_month = datetime(2026, 2, 1, tzinfo=UTC)
    pending_months = [datetime(2026, month, 1, tzinfo=UTC) for month in range(3, 7)]
    current_month = datetime(2026, 7, 1, tzinfo=UTC)

    assert not should_skip_target_report(older_month, current_month, "target", "target")
    assert all(
        should_skip_target_report(month, current_month, "target", "target")
        for month in pending_months
    )
    assert not should_skip_target_report(current_month, current_month, "supporting", "target")
    assert should_skip_target_report(current_month, current_month, "target", "target")
    reporting_month = pending_months[-1]
    assert seeded_review_status(older_month, current_month) == "Consolidated"
    assert all(
        seeded_review_status(month, current_month) == "Ready to Consolidate"
        for month in pending_months[:-1]
    )
    # The reporting month mixes waiting, returned and accepted reports by enterprise.
    assert seeded_review_status(reporting_month, current_month, 0) == "Ready to Consolidate"
    assert seeded_review_status(reporting_month, current_month, 1) == "Pending Review"
    assert seeded_review_status(reporting_month, current_month, 2) == "Returned"
    assert seeded_review_status(reporting_month, current_month, 4) == "Pending Review"
    assert seeded_review_status(current_month, current_month) == "Pending Review"


def test_sample_reports_are_sent_after_their_month_and_never_after_generation() -> None:
    generated_at = datetime(2026, 11, 7, 1, 18, tzinfo=UTC)
    current_month = datetime(2026, 11, 1, tzinfo=UTC)
    reporting_month = datetime(2026, 10, 1, tzinfo=UTC)
    september = datetime(2026, 9, 1, tzinfo=UTC)

    # The month in progress has not closed, so nobody has sent its report.
    assert all(
        sample_submitted_at(current_month, index, generated_at) is None for index in range(10)
    )
    # October's reports arrive from November 2; those planned after generation are still pending.
    sent = {index: sample_submitted_at(reporting_month, index, generated_at) for index in range(10)}
    assert sent[0] == datetime(2026, 11, 2, 1, 15, tzinfo=UTC)
    assert sent[5] is None
    assert all(value is None or value <= generated_at for value in sent.values())
    # A full past month has every report; the sixth enterprise sends late, after the 10th.
    assert sample_submitted_at(september, 5, generated_at) == datetime(
        2026, 10, 13, 6, 15, tzinfo=UTC
    )


def test_prepared_counts_cover_four_completed_months_and_current_month() -> None:
    counts = prepared_counts(
        "ENT-TEST",
        datetime(2026, 2, 15, 12, tzinfo=UTC),
    )

    assert [item["period"] for item in counts] == [
        "October 2025",
        "November 2025",
        "December 2025",
        "January 2026",
        "February 2026",
    ]
    assert len({item["reportId"] for item in counts}) == 5


@pytest.mark.asyncio
async def test_latest_sample_telemetry_starts_with_zero_live_occupancy() -> None:
    target = _enterprise_account("enterprise-1", "Enterprise 1")
    db = MagicMock()
    db.flush = AsyncMock()

    scenario = await create_admin_visitor_history(
        db,
        datetime(2026, 7, 21, 12, tzinfo=UTC),
        "full-workflow",
        random.Random("sample-test"),
        [target],
        target,
    )

    latest = max(scenario.telemetry, key=lambda snapshot: snapshot.received_at)
    assert scenario.current_visitors > 0
    assert latest.current_occupancy == 0
    assert latest.entries is not None and latest.exits is not None
    assert latest.peak_occupancy is not None
    assert latest.entries - latest.exits == scenario.current_visitors
    assert latest.peak_occupancy >= scenario.current_visitors


@pytest.mark.asyncio
async def test_sample_final_reports_leave_out_enterprises_without_a_report() -> None:
    february_reports = [
        _consolidated_report(
            "REP-FEB-1", "enterprise-1", datetime(2026, 3, 2, tzinfo=UTC), "February 2026"
        ),
        _consolidated_report(
            "REP-FEB-2", "enterprise-2", datetime(2026, 3, 4, tzinfo=UTC), "February 2026"
        ),
    ]
    december_report = _consolidated_report(
        "REP-DEC-2", "enterprise-2", datetime(2026, 1, 4, tzinfo=UTC), "December 2025"
    )
    db = MagicMock()
    db.flush = AsyncMock()

    final_reports = await create_final_reports(
        db, {"reports": [*february_reports, december_report]}
    )

    # December's report is sent in January, yet it belongs to December 2025.
    assert sorted(report.period for report in final_reports) == ["December 2025", "February 2026"]
    february = next(report for report in final_reports if report.period == "February 2026")
    assert february.enterprise_count == 2
    assert february.total_unique == 160


def _details(month: date, last_day: date) -> dict:
    return sample_report_details(
        seed="enterprise:October 2026",
        enterprise_id="park_001@tanaw.sanpedro",
        camera_name="Park Main Entrance",
        month=month,
        last_day=last_day,
        entries=1214,
        exits=1189,
        unique_count=862,
        peak=59,
    )


def test_sample_report_payload_passes_desktop_submission_validation() -> None:
    details = _details(date(2026, 10, 1), date(2026, 10, 31))

    accepted = DesktopReportSubmissionIngest(
        submissionId=UUID("8f0c8d55-8a3e-4a55-9a49-8d7c1f2ad7f1"),
        reportId="SAMPLE-REP-261001",
        period="October 2026",
        submittedAt=datetime(2026, 11, 2, 1, tzinfo=UTC),
        entries=1214,
        exits=1189,
        peakOccupancy=59,
        uniqueCount=862,
        payload={**details, "metrics": {"entries": 1214, "exits": 1189, "peak": 59, "unique": 862}},
    )

    assert accepted.uniqueCount == 862


def test_sample_report_fills_every_day_with_visitors_and_origins() -> None:
    details = _details(date(2026, 10, 1), date(2026, 10, 31))
    days = details["counting"]["days"]

    assert [day["business_date"] for day in days] == [f"2026-10-{day:02d}" for day in range(1, 32)]
    assert sorted(details["origins"]) == [day["business_date"] for day in days]
    assert sum(day["unique_count"] for day in days) == 862
    assert sum(day["entries"] for day in days) == 1214
    assert sum(day["exits"] for day in days) == 1189
    assert max(day["peak_occupancy"] for day in days) == 59
    for day in days:
        origins = details["origins"][day["business_date"]]
        assert day["male_count"] + day["female_count"] == day["unique_count"]
        assert sum(origins[origin]["male"] for origin in origins) <= day["male_count"]
        assert sum(origins[origin]["female"] for origin in origins) <= day["female_count"]
        assert day["exits"] <= day["entries"]
    assert (
        sum(
            int(value)
            for key, value in details["demo"].items()
            if key.startswith(("thisProv", "otherProv", "foreign"))
        )
        == 862
    )
    assert details["var1"]["thisCityMale"] == details["demo"]["thisCityMale"]


def test_report_for_the_month_in_progress_covers_only_elapsed_days() -> None:
    generated_at = datetime(2026, 11, 19, 1, 18, tzinfo=UTC)
    month_start = datetime(2026, 11, 1, tzinfo=UTC)
    last_day = last_reported_day(month_start, generated_at)
    details = _details(date(2026, 11, 1), last_day)

    assert last_day == date(2026, 11, 18)
    assert details["counting"]["days"][-1]["business_date"] == "2026-11-18"
    assert details["counting"]["from_at"] == "2026-11-01T00:00:00+08:00"
    assert details["counting"]["to_at"] == "2026-12-01T00:00:00+08:00"
    assert last_reported_day(datetime(2026, 10, 1, tzinfo=UTC), generated_at) == date(2026, 10, 31)
    assert last_reported_day(month_start, datetime(2026, 11, 1, 1, tzinfo=UTC)) == date(2026, 11, 1)


def test_staff_notification_reports_include_current_submission_and_resubmission() -> None:
    reporting_month = datetime(2026, 7, 1, tzinfo=UTC)
    older_report = _report("REP-260601", datetime(2026, 7, 4, tzinfo=UTC), "June 2026")
    submitted_report = _report("REP-260701", datetime(2026, 8, 4, tzinfo=UTC), "July 2026")
    submitted_report.review_status = "Pending Review"
    resubmitted_report = _report("REP-260702", datetime(2026, 8, 9, tzinfo=UTC), "July 2026")
    resubmitted_report.review_status = "Pending Review"
    extra_current_report = _report("REP-260703", datetime(2026, 8, 5, tzinfo=UTC), "July 2026")

    prepared = prepare_staff_notification_reports(
        [older_report, submitted_report, extra_current_report, resubmitted_report],
        reporting_month,
    )

    assert prepared == [
        (submitted_report, STAFF_REPORT_SUBMITTED_NOTIFICATION),
        (resubmitted_report, STAFF_REPORT_RESUBMITTED_NOTIFICATION),
    ]
    assert submitted_report.review_status == "Pending Review"
    assert resubmitted_report.review_status == "Pending Review"
    assert submitted_report.payload_json is not None
    assert resubmitted_report.payload_json is not None
    assert json.loads(submitted_report.payload_json)["status"] == "Submitted"
    assert json.loads(resubmitted_report.payload_json)["status"] == "Resubmitted"
    assert older_report.review_status == "Ready to Consolidate"
    assert extra_current_report.review_status == "Ready to Consolidate"


@pytest.mark.asyncio
async def test_mock_staff_notifications_match_production_notification_shape() -> None:
    staff = Account(
        id="staff-account",
        email="staff@example.com",
        password_hash="hash",
        role=AccountRole.STAFF,
        display_name="Staff User",
        title="LGU Staff",
        status=AccountStatus.ACTIVE,
    )
    report = _report("REP-260701", datetime(2026, 7, 18, tzinfo=UTC))
    db = MagicMock()
    db.flush = AsyncMock()

    count = await create_staff_report_notifications(
        db,
        [staff],
        [(report, STAFF_REPORT_SUBMITTED_NOTIFICATION)],
    )

    assert count == 1
    notification = db.add.call_args.args[0]
    assert isinstance(notification, UserNotification)
    assert notification.recipient_account_id == staff.id
    assert notification.notification_type == STAFF_REPORT_SUBMITTED_NOTIFICATION
    assert notification.source_type == "enterprise.report"
    assert notification.source_id == report.id
    db.flush.assert_awaited_once()


@pytest.mark.asyncio
async def test_sample_operations_cover_admin_and_it_workflows() -> None:
    lgu_accounts = [
        _account("admin-account", AccountRole.ADMIN),
        _account("it-account", AccountRole.IT),
    ]
    enterprises = [
        _enterprise_account(f"enterprise-{index}", f"Enterprise {index}") for index in range(1, 4)
    ]
    db = MagicMock()
    db.flush = AsyncMock()

    counts = await create_portal_workflow_data(
        db,
        lgu_accounts,
        enterprises,
        datetime(2026, 7, 21, 12, tzinfo=UTC),
        AdminVisitorScenario(
            enterprise=enterprises[0],
            current_visitors=84,
            typical_visitors=40,
            captured_at=datetime(2026, 7, 21, 12, tzinfo=UTC),
            telemetry=[],
        ),
    )

    added_records = [call.args[0] for call in db.add.call_args_list]
    batches = [item for call in db.add_all.call_args_list for item in call.args[0]]
    alerts = [item for item in batches if isinstance(item, OperationalAlert)]
    busy = next(alert for alert in alerts if alert.alert_type == "Busier Than Usual")
    camera = next(alert for alert in alerts if alert.alert_type == "Camera Not Counting")
    failed_email = next(record for record in added_records if isinstance(record, EmailOutbox))
    requests = [item for item in batches if isinstance(item, Request)]
    notifications = [item for item in batches if isinstance(item, UserNotification)]
    assert busy.status == camera.status == "Active"
    assert busy.source_id == "visitor-activity:enterprise-1"
    assert "84 visitors" in busy.summary
    assert "usual 40" in busy.summary
    assert camera.alert_code == "ALT-SAMPLE-002"
    assert camera.camera == "Entrance"
    assert failed_email.status == "terminal_failed"
    assert [(request.request_group, request.status) for request in requests] == [
        ("Desktop app or camera problem", "In Progress"),
        ("Report problem", "In Progress"),
        ("Account change", "In Progress"),
        ("Sign-in help", "In Progress"),
    ]
    change = next(request for request in requests if request.change_field)
    assert (
        json.loads(enterprises[2].preferences_json or "{}")["pendingContactNumberChange"]["phone"]
        == change.change_value
    )
    # The Admin has no notification bell; only IT gets notifications.
    assert {notification.recipient_role for notification in notifications} == {AccountRole.IT.value}
    assert {notification.source_type for notification in notifications} == {
        "request",
        "email.delivery",
    }
    assert counts == {
        "itNotifications": 5,
        "operationalAlerts": 2,
        "requests": 4,
        "emailProblems": 1,
        "activityLogs": 7,
    }
    assert db.flush.await_count == 2


def _account(account_id: str, role: AccountRole) -> Account:
    return Account(
        id=account_id,
        email=f"{account_id}@example.com",
        password_hash="hash",
        role=role,
        display_name=account_id,
        title=role.value,
        status=AccountStatus.ACTIVE,
    )


def _enterprise_account(account_id: str, name: str) -> Account:
    account = _account(account_id, AccountRole.ENTERPRISE)
    account.enterprise_profile = EnterpriseProfile(
        account_id=account_id,
        enterprise_id=f"ENT-{account_id}",
        enterprise_name=name,
        attraction_code="411",
        manager_name="Test Manager",
        barangay="Nueva",
        building_capacity=250,
    )
    return account


def _report(
    report_id: str, submitted_at: datetime, period: str | None = None
) -> EnterpriseReportSubmission:
    return EnterpriseReportSubmission(
        id=f"{report_id}-id",
        report_id=report_id,
        enterprise_profile_id="enterprise-account",
        enterprise_name="Test Enterprise",
        attraction_code="411",
        barangay="Nueva",
        period=period or f"{submitted_at:%b} 1 - {submitted_at:%b} 31, {submitted_at.year}",
        month=(period or submitted_at.strftime("%B")).split(" ")[0],
        submitted_at=submitted_at,
        entries=100,
        exits=90,
        peak_occupancy=20,
        unique_count=80,
        status="Submitted",
        review_status="Ready to Consolidate",
        notes="Monthly visitor count submitted for LGU review.",
        sync_status="synced",
        payload_json=json.dumps({"status": "Submitted"}),
    )


def _consolidated_report(
    report_id: str,
    enterprise_profile_id: str,
    submitted_at: datetime,
    period: str,
) -> EnterpriseReportSubmission:
    report = _report(report_id, submitted_at, period)
    report.enterprise_profile_id = enterprise_profile_id
    report.enterprise_name = enterprise_profile_id
    report.review_status = "Consolidated"
    return report
