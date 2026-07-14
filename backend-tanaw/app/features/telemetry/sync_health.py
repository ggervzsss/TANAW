"""Shared durable-outbox sync-health policy for live state and alerts."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

SYNC_ALERT_PENDING_COUNT_THRESHOLD = 10
SYNC_ALERT_OLDEST_AGE_SECONDS = 300
SYNC_RECOVERY_PENDING_COUNT_THRESHOLD = 2
SYNC_RECOVERY_OLDEST_AGE_SECONDS = 60


@dataclass(frozen=True, slots=True)
class SyncHealthDecision:
    state: Literal["healthy", "delayed", "recovering", "unknown"]
    pending_count: int | None
    oldest_pending_age_seconds: int | None

    @property
    def opens_alert(self) -> bool:
        return self.state == "delayed"

    @property
    def resolves_alert(self) -> bool:
        return self.state == "healthy"


def evaluate_sync_health(
    *,
    evaluated_at: datetime,
    pending_count: int | None,
    oldest_pending_at: datetime | None,
    alert_is_active: bool = False,
) -> SyncHealthDecision:
    """Apply opening thresholds and lower recovery hysteresis to durable evidence."""

    evaluated_at = _as_utc(evaluated_at)
    if pending_count is None:
        return SyncHealthDecision("unknown", None, None)
    if pending_count < 0:
        raise ValueError("Sync-health pending count cannot be negative.")
    if pending_count == 0:
        if oldest_pending_at is not None:
            raise ValueError("A healthy empty outbox cannot have an oldest pending timestamp.")
        return SyncHealthDecision("healthy", 0, None)
    if oldest_pending_at is None:
        raise ValueError("A non-empty outbox must record its oldest pending timestamp.")
    oldest_age = max(0, int((evaluated_at - _as_utc(oldest_pending_at)).total_seconds()))
    opens = (
        pending_count >= SYNC_ALERT_PENDING_COUNT_THRESHOLD
        or oldest_age >= SYNC_ALERT_OLDEST_AGE_SECONDS
    )
    if opens:
        return SyncHealthDecision("delayed", pending_count, oldest_age)
    recovered = (
        pending_count <= SYNC_RECOVERY_PENDING_COUNT_THRESHOLD
        and oldest_age < SYNC_RECOVERY_OLDEST_AGE_SECONDS
    )
    if not alert_is_active or recovered:
        return SyncHealthDecision("healthy", pending_count, oldest_age)
    return SyncHealthDecision("recovering", pending_count, oldest_age)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Sync-health timestamps must include a UTC offset.")
    return value.astimezone(UTC)
