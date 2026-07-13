from datetime import UTC, datetime, timedelta

import pytest

from app.features.reporting.contracts import (
    METRIC_CATALOG,
    FinalReportScope,
    monthly_reporting_period,
    reporting_period_for_timestamp,
    reporting_period_from_key,
)


def test_monthly_period_uses_manila_half_open_utc_window() -> None:
    period = monthly_reporting_period(2026, 6)

    assert period.natural_key == "month:Asia/Manila:2026-06"
    assert period.label == "June 2026"
    assert period.starts_at == datetime(2026, 5, 31, 16, 0, tzinfo=UTC)
    assert period.ends_at == datetime(2026, 6, 30, 16, 0, tzinfo=UTC)
    assert period.submission_opens_at == period.ends_at
    assert period.submission_closes_at == period.ends_at + timedelta(days=15)
    assert period.contains(datetime(2026, 6, 30, 15, 59, 59, 999999, tzinfo=UTC))
    assert not period.contains(datetime(2026, 6, 30, 16, 0, tzinfo=UTC))


def test_timestamp_at_manila_month_boundary_selects_next_period() -> None:
    before_boundary = reporting_period_for_timestamp(
        datetime(2026, 6, 30, 15, 59, 59, 999999, tzinfo=UTC)
    )
    at_boundary = reporting_period_for_timestamp(datetime(2026, 6, 30, 16, 0, tzinfo=UTC))

    assert before_boundary.natural_key == "month:Asia/Manila:2026-06"
    assert at_boundary.natural_key == "month:Asia/Manila:2026-07"


def test_timestamp_at_manila_year_boundary_selects_next_year() -> None:
    before_boundary = reporting_period_for_timestamp(
        datetime(2026, 12, 31, 15, 59, 59, 999999, tzinfo=UTC)
    )
    at_boundary = reporting_period_for_timestamp(datetime(2026, 12, 31, 16, 0, tzinfo=UTC))

    assert before_boundary.natural_key == "month:Asia/Manila:2026-12"
    assert at_boundary.natural_key == "month:Asia/Manila:2027-01"


def test_period_key_round_trips_without_using_display_label() -> None:
    period = reporting_period_from_key("month:Asia/Manila:2026-12")

    assert period.natural_key == "month:Asia/Manila:2026-12"
    assert period.label == "December 2026"
    assert period.ends_at == datetime(2026, 12, 31, 16, 0, tzinfo=UTC)


@pytest.mark.parametrize(
    "invalid_key",
    ("June 2026", "month:UTC:2026-06", "month:Asia/Manila:2026-6", ""),
)
def test_period_key_rejects_display_strings_and_noncanonical_values(invalid_key: str) -> None:
    with pytest.raises(ValueError, match="month:Asia/Manila:YYYY-MM"):
        reporting_period_from_key(invalid_key)


def test_period_classification_rejects_naive_timestamps() -> None:
    with pytest.raises(ValueError, match="UTC offset"):
        reporting_period_for_timestamp(datetime(2026, 6, 1, 0, 0))


def test_period_rejects_a_month_without_a_representable_exclusive_end() -> None:
    with pytest.raises(ValueError, match="exclusive end boundary"):
        monthly_reporting_period(9999, 12)


def test_unique_metric_does_not_claim_citywide_distinct_people() -> None:
    definition = METRIC_CATALOG["unique_visitor_estimate"]

    assert definition.distinct_across_enterprises is False
    assert "not a distinct citywide-person count" in definition.description


def test_final_scope_is_always_explicit() -> None:
    assert set(FinalReportScope) == {
        FinalReportScope.CITYWIDE,
        FinalReportScope.BARANGAY,
        FinalReportScope.ENTERPRISE_SELECTION,
    }
