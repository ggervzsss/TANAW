from datetime import UTC, datetime

from app.core.date_time import format_philippine_datetime


def test_format_philippine_datetime_converts_from_utc() -> None:
    value = datetime(2026, 7, 19, 18, 5, tzinfo=UTC)

    assert format_philippine_datetime(value) == ("Jul 20, 2026 at 2:05 AM Philippine Time")


def test_format_philippine_datetime_treats_naive_values_as_utc() -> None:
    value = datetime(2026, 7, 20, 4, 30)

    assert format_philippine_datetime(value) == ("Jul 20, 2026 at 12:30 PM Philippine Time")
