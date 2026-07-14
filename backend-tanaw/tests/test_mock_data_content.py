import random
from datetime import UTC, datetime

from app.core.password_policy import validate_password_policy
from app.features.mock_data.cli import (
    ENTERPRISES,
    LGU_ACCOUNTS,
    REPORTING_STAFF_NAME,
    TEST_ACCOUNT_PASSWORD,
    create_prepared_report_counts,
    desktop_preparation_payload,
    mock_preparation_counts,
)
from app.features.operational.schemas import MockPreparationCounts


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


def test_prepared_counts_are_bounded_to_two_canonical_periods() -> None:
    prepared = create_prepared_report_counts(
        datetime(2026, 1, 1, tzinfo=UTC),
        datetime(2026, 6, 30, tzinfo=UTC),
        "full-workflow",
        random.Random("target-simulation"),
    )

    assert [item["periodKey"] for item in prepared] == [
        "month:Asia/Manila:2026-05",
        "month:Asia/Manila:2026-06",
    ]


def test_mock_preparation_persists_canonical_period_identity_and_manila_bounds() -> None:
    counts = mock_preparation_counts(
        month_start=datetime(2026, 6, 1, tzinfo=UTC),
        entries=100,
        exits=40,
        unique_count=75,
        peak_occupancy=61,
        period_label_value="Jun 1 - Jun 30, 2026",
    )

    parsed = MockPreparationCounts.model_validate(counts)

    assert parsed.period == "Jun 1 - Jun 30, 2026"
    assert parsed.periodKey == "month:Asia/Manila:2026-06"
    assert counts["sourceWindow"] == {
        "start": "2026-05-31T16:00:00.000Z",
        "end": "2026-06-30T16:00:00.000Z",
    }


def test_mock_preparation_rejects_label_only_or_mismatched_period_identity() -> None:
    counts = mock_preparation_counts(
        month_start=datetime(2026, 12, 1, tzinfo=UTC),
        entries=10,
        exits=4,
        unique_count=7,
        peak_occupancy=6,
        period_label_value="Dec 1 - Dec 31, 2026",
    )

    invalid_key = {**counts, "periodKey": "Dec 1 - Dec 31, 2026"}
    invalid_window = {
        **counts,
        "sourceWindow": {
            "start": "2026-11-30T16:00:00.000Z",
            "end": "2027-01-31T16:00:00.000Z",
        },
    }

    for candidate in (invalid_key, invalid_window):
        try:
            MockPreparationCounts.model_validate(candidate)
        except ValueError:
            pass
        else:  # pragma: no cover - assertion branch
            raise AssertionError("Invalid mock-preparation period identity was accepted.")


def test_optional_desktop_callback_forwards_canonical_period_contract() -> None:
    counts = mock_preparation_counts(
        month_start=datetime(2026, 6, 1, tzinfo=UTC),
        entries=100,
        exits=40,
        unique_count=75,
        peak_occupancy=61,
        period_label_value="Jun 1 - Jun 30, 2026",
    )

    payload = desktop_preparation_payload(
        run_id="run-1",
        enterprise_id="enterprise-1",
        enterprise_name="Enterprise One",
        prepared=counts,
    )

    assert "period" not in payload
    assert payload["period_id"] == "month:Asia/Manila:2026-06"
    assert payload["source_window"] == counts["sourceWindow"]
