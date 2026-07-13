from datetime import UTC, datetime, timedelta

import pytest

from app.features.topology.access import is_effective_at

EVALUATED_AT = datetime(2026, 7, 13, 8, 15, 3, tzinfo=UTC)


@pytest.mark.parametrize(
    ("started_at", "ended_at", "expected"),
    [
        (EVALUATED_AT, None, True),
        (EVALUATED_AT - timedelta(days=1), None, True),
        (EVALUATED_AT - timedelta(days=1), EVALUATED_AT + timedelta(seconds=1), True),
        (EVALUATED_AT + timedelta(microseconds=1), None, False),
        (EVALUATED_AT - timedelta(days=1), EVALUATED_AT, False),
        (EVALUATED_AT - timedelta(days=2), EVALUATED_AT - timedelta(days=1), False),
    ],
)
def test_effective_topology_intervals_are_start_inclusive_and_end_exclusive(
    started_at: datetime,
    ended_at: datetime | None,
    expected: bool,
) -> None:
    assert (
        is_effective_at(
            started_at=started_at,
            ended_at=ended_at,
            evaluated_at=EVALUATED_AT,
        )
        is expected
    )


def test_effective_topology_interval_rejects_naive_timestamps() -> None:
    with pytest.raises(ValueError, match="UTC offset"):
        is_effective_at(
            started_at=EVALUATED_AT.replace(tzinfo=None),
            ended_at=None,
            evaluated_at=EVALUATED_AT,
        )
