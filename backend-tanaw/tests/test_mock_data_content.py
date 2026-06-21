from datetime import UTC, datetime

from app.features.mock_data.cli import (
    ENTERPRISES,
    LGU_ACCOUNTS,
    REPORTING_STAFF_NAME,
    TEST_ACCOUNT_PASSWORD,
    seeded_review_status,
    should_skip_target_report,
)


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


def test_only_target_enterprise_is_missing_for_current_month() -> None:
    previous_month = datetime(2026, 5, 1, tzinfo=UTC)
    current_month = datetime(2026, 6, 1, tzinfo=UTC)

    assert not should_skip_target_report(previous_month, current_month, "target", "target")
    assert not should_skip_target_report(current_month, current_month, "supporting", "target")
    assert should_skip_target_report(current_month, current_month, "target", "target")
    assert seeded_review_status(previous_month, current_month) == "Consolidated"
    assert seeded_review_status(current_month, current_month) == "Ready to Consolidate"
