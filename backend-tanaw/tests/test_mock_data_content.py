import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.password_policy import validate_password_policy
from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.mock_data.cli import (
    DEMOGRAPHIC_FIELDS,
    ENTERPRISES,
    LGU_ACCOUNTS,
    REPORTING_STAFF_NAME,
    TEST_ACCOUNT_PASSWORD,
    build_demographic_breakdown,
    create_staff_report_notifications,
    prepare_staff_notification_reports,
    seeded_review_status,
    should_skip_target_report,
)
from app.features.operational.models import EnterpriseReportSubmission, UserNotification
from app.features.operational.service import (
    STAFF_REPORT_RESUBMITTED_NOTIFICATION,
    STAFF_REPORT_SUBMITTED_NOTIFICATION,
)


def test_generated_enterprises_match_configured_locations_and_contacts() -> None:
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


def test_target_enterprise_is_missing_for_previous_and_current_month() -> None:
    older_month = datetime(2026, 4, 1, tzinfo=UTC)
    previous_month = datetime(2026, 5, 1, tzinfo=UTC)
    current_month = datetime(2026, 6, 1, tzinfo=UTC)

    assert not should_skip_target_report(older_month, current_month, "target", "target")
    assert should_skip_target_report(previous_month, current_month, "target", "target")
    assert not should_skip_target_report(current_month, current_month, "supporting", "target")
    assert should_skip_target_report(current_month, current_month, "target", "target")
    assert seeded_review_status(older_month, current_month) == "Consolidated"
    assert seeded_review_status(previous_month, current_month) == "Ready to Consolidate"
    assert seeded_review_status(current_month, current_month) == "Ready to Consolidate"


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


def _report(report_id: str, submitted_at: datetime) -> EnterpriseReportSubmission:
    return EnterpriseReportSubmission(
        id=f"{report_id}-id",
        report_id=report_id,
        enterprise_account_id="enterprise-account",
        enterprise_id="ENT-001",
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
        source_kind="mock",
        mock_run_id="run-id",
    )
