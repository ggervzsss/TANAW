from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.operational_observability import (
    OperationalCounter,
    OperationalObservability,
)
from app.features.events.delivery import DeliveryQueueMetrics
from app.features.maintenance.operations import (
    LiveFreshnessMetrics,
    read_live_freshness_metrics,
)
from app.features.maintenance.schemas import to_operational_status_response


def test_process_metrics_have_fixed_payload_free_dimensions() -> None:
    metrics = OperationalObservability()
    observed_at = datetime(2026, 7, 15, 8, 0, tzinfo=UTC)

    metrics.increment(OperationalCounter.REPORT_COMMAND_REPLAY)
    metrics.increment(OperationalCounter.REPORT_HASH_CONFLICT)
    metrics.record_finalization_scope("barangay")
    metrics.observe_telemetry_lag(
        observed_at=observed_at - timedelta(seconds=3),
        received_at=observed_at,
    )
    metrics.observe_domain_event_publish_lag(
        available_at=observed_at - timedelta(seconds=2),
        delivered_at=observed_at,
    )

    snapshot = metrics.snapshot(observed_at=observed_at)
    assert snapshot.counters["report_command_replays"] == 1
    assert snapshot.counters["report_hash_conflicts"] == 1
    assert set(snapshot.counters) == {counter.value for counter in OperationalCounter}
    assert snapshot.finalization_scopes == {
        "citywide": 0,
        "barangay": 1,
        "enterprise_selection": 0,
    }
    assert snapshot.telemetry_lag.latest_seconds == 3
    assert snapshot.domain_event_publish_lag.maximum_seconds == 2


@pytest.mark.asyncio
async def test_live_freshness_gauge_ages_without_new_telemetry() -> None:
    observed_at = datetime(2026, 7, 15, 8, 0, tzinfo=UTC)
    result = MagicMock()
    result.all.return_value = [
        (observed_at + timedelta(seconds=1), observed_at + timedelta(minutes=3)),
        (observed_at - timedelta(seconds=1), observed_at + timedelta(seconds=1)),
        (observed_at - timedelta(minutes=5), observed_at),
        (None, None),
    ]
    db = MagicMock()
    db.execute = AsyncMock(return_value=result)

    metrics = await read_live_freshness_metrics(db, observed_at=observed_at)

    assert metrics == LiveFreshnessMetrics(fresh=1, stale=1, offline=1, unobserved=1)


def test_operational_response_combines_process_and_durable_queue_gauges() -> None:
    observed_at = datetime(2026, 7, 15, 8, 0, tzinfo=UTC)
    snapshot = OperationalObservability().snapshot(observed_at=observed_at)
    queue = DeliveryQueueMetrics(
        pending=2,
        leased=1,
        retry_scheduled=3,
        delivered=8,
        dead_letter=1,
        oldest_pending_at=observed_at - timedelta(seconds=45),
        oldest_ready_at=observed_at - timedelta(seconds=10),
        oldest_lease_expiry_at=observed_at + timedelta(seconds=30),
    )

    response = to_operational_status_response(
        snapshot,
        queue,
        LiveFreshnessMetrics(fresh=4, stale=2, offline=1, unobserved=3),
    )

    assert response.processInstanceOnly is True
    assert response.domainEventQueue.oldestPendingAgeSeconds == 45
    assert response.domainEventQueue.deadLetter == 1
    assert response.officialLiveSites.offline == 1
