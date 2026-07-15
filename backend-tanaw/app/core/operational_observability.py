"""Payload-free process metrics for target report and telemetry operations."""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from threading import Lock
from typing import Literal

logger = logging.getLogger("uvicorn.error")


class OperationalCounter(StrEnum):
    PERIOD_CLASSIFICATION_FAILURE = "period_classification_failures"
    REPORT_COMMAND_REPLAY = "report_command_replays"
    REPORT_HASH_CONFLICT = "report_hash_conflicts"
    REPORT_REVISION_CONFLICT = "report_revision_conflicts"
    REPORT_STATE_TRANSITION_CONFLICT = "report_state_transition_conflicts"
    FINALIZATION_COMMAND_REPLAY = "finalization_command_replays"
    FINALIZATION_CONFLICT = "finalization_conflicts"
    FINAL_ARTIFACT_HASH_FAILURE = "final_artifact_hash_failures"
    TELEMETRY_COMMAND_REPLAY = "telemetry_command_replays"
    TELEMETRY_PROJECTION_OUT_OF_ORDER = "telemetry_projection_out_of_order"
    DOMAIN_EVENT_CONSUMER_DEDUPLICATION = "domain_event_consumer_deduplications"
    DOMAIN_EVENT_DELIVERY_RETRY = "domain_event_delivery_retries"
    DOMAIN_EVENT_DELIVERY_DEAD_LETTER = "domain_event_delivery_dead_letters"
    TARGET_CLIENT_REQUEST = "target_client_requests"
    OUTDATED_CLIENT_REJECTION = "outdated_client_rejections"


@dataclass(frozen=True, slots=True)
class LagSnapshot:
    observations: int
    latest_seconds: float | None
    maximum_seconds: float | None


@dataclass(frozen=True, slots=True)
class OperationalSnapshot:
    observed_at: datetime
    counters: dict[str, int]
    finalization_scopes: dict[str, int]
    telemetry_lag: LagSnapshot
    domain_event_publish_lag: LagSnapshot


@dataclass(slots=True)
class _LagAccumulator:
    observations: int = 0
    latest_seconds: float | None = None
    maximum_seconds: float | None = None

    def observe(self, seconds: float) -> None:
        bounded = max(0.0, round(seconds, 6))
        self.observations += 1
        self.latest_seconds = bounded
        self.maximum_seconds = (
            bounded if self.maximum_seconds is None else max(self.maximum_seconds, bounded)
        )

    def snapshot(self) -> LagSnapshot:
        return LagSnapshot(
            observations=self.observations,
            latest_seconds=self.latest_seconds,
            maximum_seconds=self.maximum_seconds,
        )


class OperationalObservability:
    """Thread-safe process metrics; durable queue gauges are queried separately."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._counters: Counter[str] = Counter()
        self._finalization_scopes: Counter[str] = Counter()
        self._telemetry_lag = _LagAccumulator()
        self._domain_event_publish_lag = _LagAccumulator()

    def increment(self, counter: OperationalCounter) -> None:
        with self._lock:
            self._counters[counter.value] += 1
            total = self._counters[counter.value]
        logger.info("tanaw_operational_counter name=%s total=%d", counter.value, total)

    def record_finalization_scope(
        self, scope: Literal["citywide", "barangay", "enterprise_selection"]
    ) -> None:
        with self._lock:
            self._finalization_scopes[scope] += 1
            total = self._finalization_scopes[scope]
        logger.info("tanaw_finalization_scope scope=%s total=%d", scope, total)

    def observe_telemetry_lag(self, *, observed_at: datetime, received_at: datetime) -> None:
        with self._lock:
            self._telemetry_lag.observe((_utc(received_at) - _utc(observed_at)).total_seconds())

    def observe_domain_event_publish_lag(
        self, *, available_at: datetime, delivered_at: datetime
    ) -> None:
        with self._lock:
            self._domain_event_publish_lag.observe(
                (_utc(delivered_at) - _utc(available_at)).total_seconds()
            )

    def snapshot(self, *, observed_at: datetime | None = None) -> OperationalSnapshot:
        with self._lock:
            counters = {
                counter.value: self._counters[counter.value] for counter in OperationalCounter
            }
            scopes = {
                scope: self._finalization_scopes[scope]
                for scope in ("citywide", "barangay", "enterprise_selection")
            }
            telemetry_lag = self._telemetry_lag.snapshot()
            publish_lag = self._domain_event_publish_lag.snapshot()
        return OperationalSnapshot(
            observed_at=_utc(observed_at or datetime.now(UTC)),
            counters=counters,
            finalization_scopes=scopes,
            telemetry_lag=telemetry_lag,
            domain_event_publish_lag=publish_lag,
        )


operational_observability = OperationalObservability()


def _utc(value: datetime) -> datetime:
    if value.utcoffset() is None:
        raise ValueError("Operational metric timestamps must include a timezone.")
    return value.astimezone(UTC)
