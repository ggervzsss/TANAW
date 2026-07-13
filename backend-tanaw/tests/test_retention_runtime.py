from unittest.mock import AsyncMock

import pytest

from app.core.config import Settings
from app.features.maintenance import runtime
from app.features.maintenance.retention import RetentionCleanupCounts
from app.features.maintenance.telemetry_retention import (
    ClassificationTelemetryObservability,
    TelemetryRetentionCounts,
    TelemetryRetentionObservability,
)


@pytest.fixture(autouse=True)
def reset_retention_runtime(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runtime, "_metrics", runtime.RetentionRuntimeMetrics())
    monkeypatch.setattr(runtime, "_cleanup_lock", None)
    monkeypatch.setattr(runtime, "_worker_task", None)
    monkeypatch.setattr(runtime, "_worker_stop_event", None)


@pytest.mark.asyncio
async def test_manual_cleanup_records_counts_and_safe_metrics(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    expected = RetentionCleanupCounts(
        activation_tokens=2,
        password_reset_challenges=3,
        development_deliveries=1,
        telemetry=TelemetryRetentionCounts(
            observations_downsampled=4,
            metric_facts_rolled_up=8,
            metric_facts_deleted=2,
            observability=TelemetryRetentionObservability(
                official=ClassificationTelemetryObservability(
                    ingestion_lag_seconds=5.0,
                    unprocessed_observations=1,
                )
            ),
        ),
    )
    cleanup = AsyncMock(return_value=expected)
    monkeypatch.setattr(runtime, "run_retention_cleanup", cleanup)

    result = await runtime.run_retention_cleanup_now(Settings())
    snapshot = runtime.retention_runtime_snapshot()

    assert result == expected
    assert snapshot.running is False
    assert snapshot.completed_runs == 1
    assert snapshot.failed_runs == 0
    assert snapshot.last_error is None
    assert snapshot.last_counts == expected
    assert snapshot.total_counts == expected
    assert snapshot.last_started_at is not None
    assert snapshot.last_completed_at is not None
    assert snapshot.last_duration_seconds is not None
    assert snapshot.last_duration_seconds >= 0


@pytest.mark.asyncio
async def test_cleanup_failure_records_only_exception_type(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cleanup = AsyncMock(side_effect=RuntimeError("database password must stay private"))
    monkeypatch.setattr(runtime, "run_retention_cleanup", cleanup)

    with pytest.raises(RuntimeError, match="database password"):
        await runtime.run_retention_cleanup_now(Settings())

    snapshot = runtime.retention_runtime_snapshot()
    assert snapshot.running is False
    assert snapshot.completed_runs == 0
    assert snapshot.failed_runs == 1
    assert snapshot.last_error == "RuntimeError"
    assert "password" not in snapshot.last_error.lower()
    assert snapshot.last_duration_seconds is not None


def test_retention_count_total_excludes_state_transitions() -> None:
    counts = RetentionCleanupCounts(
        activation_tokens=1,
        expired_email_change_requests=5,
        email_change_requests=2,
        telemetry=TelemetryRetentionCounts(
            observations_downsampled=10,
            metric_facts_deleted=4,
            observations_deleted=2,
        ),
    )

    assert counts.deleted_records == 9


def test_retention_totals_sum_actions_but_keep_latest_telemetry_gauges() -> None:
    first = RetentionCleanupCounts(
        telemetry=TelemetryRetentionCounts(
            observations_downsampled=2,
            observability=TelemetryRetentionObservability(
                official=ClassificationTelemetryObservability(
                    ingestion_lag_seconds=30,
                    unprocessed_observations=3,
                )
            ),
        )
    )
    second = RetentionCleanupCounts(
        telemetry=TelemetryRetentionCounts(
            observations_downsampled=4,
            observability=TelemetryRetentionObservability(
                official=ClassificationTelemetryObservability(
                    ingestion_lag_seconds=5,
                    unprocessed_observations=1,
                )
            ),
        )
    )

    total = runtime._add_counts(first, second)

    assert total.telemetry.observations_downsampled == 6
    assert total.telemetry.observability.official.ingestion_lag_seconds == 5
    assert total.telemetry.observability.official.unprocessed_observations == 1
