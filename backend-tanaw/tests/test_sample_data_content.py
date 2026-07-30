import json
import random
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.password_policy import validate_password_policy
from app.features.accounts.models import (
    Account,
    AccountRole,
    AccountStatus,
    EnterpriseProfile,
)
from app.features.mail.models import EmailOutbox
from app.features.operational.models import (
    EnterpriseReportSubmission,
    OperationalAlert,
    SupportTicket,
    UserNotification,
)
from app.features.operational.service import (
    STAFF_REPORT_RESUBMITTED_NOTIFICATION,
    STAFF_REPORT_SUBMITTED_NOTIFICATION,
)
from app.features.sample_data.cli import (
    DEMOGRAPHIC_FIELDS,
    ENTERPRISES,
    LGU_ACCOUNTS,
    REPORTING_STAFF_NAME,
    TEST_ACCOUNT_PASSWORD,
    AdminVisitorScenario,
    build_demographic_breakdown,
    create_admin_visitor_history,
    create_final_reports,
    create_portal_workflow_data,
    create_staff_report_notifications,
    prepare_staff_notification_reports,
    seeded_review_status,
    should_skip_target_report,
)
from app.features.sample_data.dataset import prepared_counts


def test_sample_enterprises_match_configured_locations_and_contacts() -> None:
    expected_enterprises = (
        (
            "Balon ni Lolo Uweng",
            "tourism",
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
            "tourism",
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
            "tourism",
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
            "business",
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
            "tourism",
            "Sebastien Bercasio",
            "San Antonio",
            "Barangay San Antonio, San Pedro, Laguna 4023",
            14.357021,
            121.028243,
            "hallowridge.golf@tanaw.test",
            "+639171110005",
        ),
    )

    assert (
        tuple(
            (
                enterprise.name,
                enterprise.category,
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
                enterprise.category,
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
    assert seeded_review_status(older_month, current_month) == "Consolidated"
    assert all(
        seeded_review_status(month, current_month) == "Ready to Consolidate"
        for month in pending_months
    )
    assert seeded_review_status(current_month, current_month) == "Ready to Consolidate"


def test_prepared_counts_cover_four_completed_months_across_year_boundary() -> None:
    counts = prepared_counts(
        "ENT-TEST",
        datetime(2026, 2, 15, 12, tzinfo=UTC),
    )

    assert [item["period"] for item in counts] == [
        "October 2025",
        "November 2025",
        "December 2025",
        "January 2026",
    ]
    assert len({item["reportId"] for item in counts}) == 4


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
    assert latest.entries - latest.exits == scenario.current_visitors
    assert latest.peak_occupancy >= scenario.current_visitors


@pytest.mark.asyncio
async def test_sample_final_reports_require_every_participating_enterprise() -> None:
    complete_period_reports = [
        _consolidated_report("REP-FEB-1", "enterprise-1", datetime(2026, 2, 18, tzinfo=UTC)),
        _consolidated_report("REP-FEB-2", "enterprise-2", datetime(2026, 2, 19, tzinfo=UTC)),
    ]
    incomplete_period_reports = [
        _consolidated_report("REP-MAR-2", "enterprise-2", datetime(2026, 3, 19, tzinfo=UTC))
    ]
    db = MagicMock()
    db.flush = AsyncMock()

    final_reports = await create_final_reports(
        db,
        {"reports": [*complete_period_reports, *incomplete_period_reports]},
        expected_enterprise_ids={"enterprise-1", "enterprise-2"},
    )

    assert [report.period for report in final_reports] == ["February 2026"]
    assert final_reports[0].enterprise_count == 2
    assert final_reports[0].total_unique == 160


def test_seeded_demographics_match_unique_visitor_count() -> None:
    unique_count = 537
    demographics = build_demographic_breakdown(unique_count, enterprise_index=2, month_index=3)

    assert set(demographics) == set(DEMOGRAPHIC_FIELDS)
    assert all(value.isdigit() for value in demographics.values())
    assert sum(int(value) for value in demographics.values()) == unique_count


def test_staff_notification_reports_include_current_submission_and_resubmission() -> None:
    current_month = datetime(2026, 7, 1, tzinfo=UTC)
    older_report = _report("REP-260601", datetime(2026, 6, 18, tzinfo=UTC))
    submitted_report = _report("REP-260701", datetime(2026, 7, 18, tzinfo=UTC))
    resubmitted_report = _report("REP-260702", datetime(2026, 7, 19, tzinfo=UTC))
    extra_current_report = _report("REP-260703", datetime(2026, 7, 20, tzinfo=UTC))

    prepared = prepare_staff_notification_reports(
        [older_report, submitted_report, resubmitted_report, extra_current_report],
        current_month,
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
    alerts = [record for record in added_records if isinstance(record, OperationalAlert)]
    alert = next(record for record in alerts if record.owner == "Admin")
    technical_alert = next(record for record in alerts if record.owner == "IT")
    failed_email = next(record for record in added_records if isinstance(record, EmailOutbox))
    tickets = db.add_all.call_args_list[0].args[0]
    notifications = db.add_all.call_args_list[1].args[0]
    assert isinstance(alert, OperationalAlert)
    assert alert.owner == "Admin"
    assert alert.alert_type == "Foot Traffic Alert"
    assert alert.source_id == "visitor-activity:enterprise-1"
    assert "84 visitors" in alert.summary
    assert "usual 40" in alert.summary
    assert technical_alert.alert_code == "ALT-SAMPLE-002"
    assert technical_alert.severity == "Critical"
    assert failed_email.status == "terminal_failed"
    assert [ticket.priority for ticket in tickets if isinstance(ticket, SupportTicket)] == [
        "High",
        "Normal",
    ]
    admin_notifications = [
        notification
        for notification in notifications
        if isinstance(notification, UserNotification)
        and notification.recipient_role == AccountRole.ADMIN.value
    ]
    assert [notification.source_type for notification in admin_notifications] == [
        "operational.alert",
        "support.ticket",
    ]
    it_notifications = [
        notification
        for notification in notifications
        if isinstance(notification, UserNotification)
        and notification.recipient_role == AccountRole.IT.value
    ]
    assert {notification.source_type for notification in it_notifications} == {
        "operational.alert",
        "support.ticket",
        "email.delivery",
        "enterprise.profile.contact",
    }
    assert counts == {
        "adminNotifications": 2,
        "itNotifications": 5,
        "operationalAlerts": 2,
        "supportTickets": 2,
        "emailProblems": 1,
        "activityLogs": 4,
    }
    db.flush.assert_awaited_once()


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
        category="business",
        manager_name="Test Manager",
        barangay="Nueva",
        building_capacity=250,
    )
    return account


def _report(report_id: str, submitted_at: datetime) -> EnterpriseReportSubmission:
    return EnterpriseReportSubmission(
        id=f"{report_id}-id",
        report_id=report_id,
        enterprise_profile_id="enterprise-account",
        enterprise_name="Test Enterprise",
        category="Tourism",
        barangay="Nueva",
        period=f"{submitted_at:%b} 1 - {submitted_at:%b} 31, {submitted_at.year}",
        month=submitted_at.strftime("%B"),
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
) -> EnterpriseReportSubmission:
    report = _report(report_id, submitted_at)
    report.enterprise_profile_id = enterprise_profile_id
    report.enterprise_name = enterprise_profile_id
    report.period = submitted_at.strftime("%B %Y")
    report.review_status = "Consolidated"
    return report
