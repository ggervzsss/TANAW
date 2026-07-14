from datetime import UTC, datetime, timedelta

import pytest

from app.features.telemetry.sync_health import evaluate_sync_health

NOW = datetime(2026, 7, 14, 12, tzinfo=UTC)


def test_small_recent_backlog_is_healthy() -> None:
    decision = evaluate_sync_health(
        evaluated_at=NOW,
        pending_count=1,
        oldest_pending_at=NOW - timedelta(seconds=10),
    )

    assert decision.state == "healthy"
    assert decision.opens_alert is False


@pytest.mark.parametrize(
    ("pending_count", "age_seconds"),
    [(10, 1), (1, 300)],
)
def test_count_or_age_threshold_opens_alert(pending_count: int, age_seconds: int) -> None:
    decision = evaluate_sync_health(
        evaluated_at=NOW,
        pending_count=pending_count,
        oldest_pending_at=NOW - timedelta(seconds=age_seconds),
    )

    assert decision.state == "delayed"
    assert decision.opens_alert is True


def test_active_alert_remains_open_inside_hysteresis_band() -> None:
    decision = evaluate_sync_health(
        evaluated_at=NOW,
        pending_count=5,
        oldest_pending_at=NOW - timedelta(seconds=30),
        alert_is_active=True,
    )

    assert decision.state == "recovering"
    assert decision.resolves_alert is False


def test_active_alert_resolves_only_below_recovery_thresholds() -> None:
    decision = evaluate_sync_health(
        evaluated_at=NOW,
        pending_count=2,
        oldest_pending_at=NOW - timedelta(seconds=59),
        alert_is_active=True,
    )

    assert decision.state == "healthy"
    assert decision.resolves_alert is True


def test_unrecorded_pending_count_is_unknown() -> None:
    assert (
        evaluate_sync_health(
            evaluated_at=NOW,
            pending_count=None,
            oldest_pending_at=None,
        ).state
        == "unknown"
    )


@pytest.mark.parametrize(
    ("pending_count", "oldest_pending_at"),
    [(0, NOW), (1, None), (-1, None)],
)
def test_invalid_backlog_evidence_is_rejected(
    pending_count: int,
    oldest_pending_at: datetime | None,
) -> None:
    with pytest.raises(ValueError):
        evaluate_sync_health(
            evaluated_at=NOW,
            pending_count=pending_count,
            oldest_pending_at=oldest_pending_at,
        )


def test_naive_timestamps_are_rejected() -> None:
    with pytest.raises(ValueError, match="UTC offset"):
        evaluate_sync_health(
            evaluated_at=NOW.replace(tzinfo=None),
            pending_count=0,
            oldest_pending_at=None,
        )
