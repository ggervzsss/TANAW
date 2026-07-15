"""Durable operational gauges for the report and telemetry runtime."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.telemetry.models import SiteLiveState
from app.features.topology.models import Enterprise, EnterpriseSite


@dataclass(frozen=True, slots=True)
class LiveFreshnessMetrics:
    fresh: int
    stale: int
    offline: int
    unobserved: int


async def read_live_freshness_metrics(
    db: AsyncSession, *, observed_at: datetime | None = None
) -> LiveFreshnessMetrics:
    evaluated_at = _utc(observed_at or datetime.now(UTC))
    rows = (
        await db.execute(
            select(SiteLiveState.freshness_expires_at, SiteLiveState.offline_after_at)
            .select_from(EnterpriseSite)
            .join(Enterprise, Enterprise.id == EnterpriseSite.enterprise_id)
            .outerjoin(
                SiteLiveState,
                and_(
                    SiteLiveState.site_id == EnterpriseSite.id,
                    SiteLiveState.classification == "official",
                ),
            )
            .where(
                Enterprise.classification == "official",
                Enterprise.lifecycle_state == "active",
                EnterpriseSite.classification == "official",
                EnterpriseSite.registered_at <= evaluated_at,
                or_(
                    EnterpriseSite.retired_at.is_(None),
                    EnterpriseSite.retired_at > evaluated_at,
                ),
            )
        )
    ).all()
    counts = {"fresh": 0, "stale": 0, "offline": 0, "unobserved": 0}
    for freshness_expires_at, offline_after_at in rows:
        if freshness_expires_at is None or offline_after_at is None:
            counts["unobserved"] += 1
        elif evaluated_at < _utc(freshness_expires_at):
            counts["fresh"] += 1
        elif evaluated_at < _utc(offline_after_at):
            counts["stale"] += 1
        else:
            counts["offline"] += 1
    return LiveFreshnessMetrics(
        fresh=counts["fresh"],
        stale=counts["stale"],
        offline=counts["offline"],
        unobserved=counts["unobserved"],
    )


def age_seconds(value: datetime | None, *, observed_at: datetime) -> float | None:
    if value is None:
        return None
    return max(0.0, round((_utc(observed_at) - _utc(value)).total_seconds(), 6))


def _utc(value: datetime) -> datetime:
    if value.utcoffset() is None:
        raise ValueError("Operational gauge timestamps must include a timezone.")
    return value.astimezone(UTC)
