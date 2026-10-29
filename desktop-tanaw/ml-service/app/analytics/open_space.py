"""Deterministic visits. Appearance identities never own these timers."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

from app.analytics.polygon import Point, location
from app.config.open_space_config import OpenSpaceConfig


@dataclass
class Visit:
    visit_id: str
    track_id: int
    first: float
    last_inside: float
    last_seen: float
    arrival_observed: bool
    observations: int = 1
    confirmed: bool = False
    exit_since: float | None = None
    outside_observations: int = 0
    missing_since: float | None = None
    uncertain_gap_ms: int = 0
    uncertain_gap_count: int = 0


class AreaVisitTracker:
    def __init__(
        self,
        config: OpenSpaceConfig,
        *,
        anchor: float = 0.0,
        wall_anchor: datetime | None = None,
        id_factory: Callable[[], str] = lambda: uuid4().hex,
    ) -> None:
        self.config = config
        self.anchor = anchor
        self.wall_anchor = wall_anchor or datetime.now(UTC)
        self.id_factory = id_factory
        self.visits: dict[int, Visit] = {}
        self.outside: dict[int, float] = {}
        self.finished: list[dict[str, Any]] = []
        self.last_frame_at: float | None = None
        self.available = False
        self._fresh: set[int] = set()
        self._last_time = anchor

    def timestamp(self, at: float) -> str:
        return (self.wall_anchor + timedelta(seconds=at - self.anchor)).isoformat()

    def record(
        self,
        visit: Visit,
        status: str = "active",
        reason: str | None = None,
        departure: bool = False,
        finalized_at: float | None = None,
    ) -> dict[str, Any]:
        duration = max(0, round((visit.last_inside - visit.first) * 1000))
        return {
            "visit_id": visit.visit_id,
            "track_generation": visit.track_id,
            "first_inside_at": self.timestamp(visit.first),
            "last_inside_at": self.timestamp(visit.last_inside),
            "last_observed_at": self.timestamp(visit.last_seen),
            "ended_at": self.timestamp(visit.last_inside) if status != "active" else None,
            "finalized_at": self.timestamp(finalized_at) if finalized_at is not None else None,
            "status": status,
            "arrival_observed": visit.arrival_observed,
            "departure_observed": departure,
            "qualified": duration >= round(self.config.minimum_visit_seconds * 1000),
            "estimated_dwell_ms": duration,
            "termination_reason": reason,
            "uncertain_gap_ms": visit.uncertain_gap_ms,
            "uncertain_gap_count": visit.uncertain_gap_count,
            "observation_count": visit.observations,
            "algorithm_version": 1,
        }

    def _finish(self, track_id: int, at: float, reason: str, departure: bool = False) -> None:
        visit = self.visits.pop(track_id)
        if not visit.confirmed:
            return
        qualified = bool(self.record(visit)["qualified"])
        status = (
            ("completed" if visit.arrival_observed and departure else "incomplete")
            if qualified
            else "excluded"
        )
        self.finished.append(self.record(visit, status, reason, departure, at))
        self._fresh.discard(track_id)

    def tick(self, at: float) -> None:
        if at < self._last_time:
            return
        self._last_time = at
        for track_id, visit in list(self.visits.items()):
            if at - visit.last_seen > self.config.gap_grace_seconds:
                self._finish(track_id, at, "track_lost")
        self.outside = {
            key: seen
            for key, seen in self.outside.items()
            if at - seen <= self.config.gap_grace_seconds
        }

    def update(self, observations: dict[int, Point], at: float) -> bool:
        if at < self._last_time or (self.last_frame_at is not None and at <= self.last_frame_at):
            return False
        self.tick(at)
        self.last_frame_at = at
        self.available = True
        self._fresh.clear()
        polygon = [(p.x, p.y) for p in self.config.polygon]
        for track_id, point in observations.items():
            visit = self.visits.get(track_id)
            where = location(point, polygon, self.config.boundary_tolerance)
            inside = where > 0 or (where == 0 and visit is not None and visit.exit_since is None)
            if inside:
                if visit is None:
                    visit = Visit(self.id_factory(), track_id, at, at, at, track_id in self.outside)
                    self.visits[track_id] = visit
                else:
                    if visit.missing_since is not None or visit.exit_since is not None:
                        visit.uncertain_gap_ms += max(0, round((at - visit.last_inside) * 1000))
                        visit.uncertain_gap_count += 1
                    visit.last_inside = at
                    visit.last_seen = at
                    visit.observations += 1
                    visit.exit_since = None
                    visit.outside_observations = 0
                    visit.missing_since = None
                if (
                    visit.observations >= 2
                    and at - visit.first >= self.config.entry_confirmation_seconds
                ):
                    visit.confirmed = True
                if visit.confirmed:
                    self._fresh.add(track_id)
            elif where < 0:
                self.outside[track_id] = at
                if visit is not None:
                    visit.last_seen = at
                    if not visit.confirmed:
                        del self.visits[track_id]
                        continue
                    visit.exit_since = at if visit.exit_since is None else visit.exit_since
                    visit.outside_observations += 1
                    if (
                        visit.outside_observations >= 2
                        and at - visit.exit_since >= self.config.exit_confirmation_seconds
                    ):
                        self._finish(track_id, at, "observed_exit", departure=True)
        for track_id, visit in self.visits.items():
            if track_id not in observations and visit.missing_since is None:
                visit.missing_since = at
        return True

    def interrupt(self, at: float, reason: str) -> None:
        for track_id in list(self.visits):
            self._finish(track_id, at, reason)
        self.outside.clear()
        self._fresh.clear()
        self.available = False
        self._last_time = max(self._last_time, at)

    def drain(self) -> list[dict[str, Any]]:
        result, self.finished = self.finished, []
        return result

    def active_records(self) -> list[dict[str, Any]]:
        return [self.record(v) for v in self.visits.values() if v.confirmed]

    @property
    def observed_track_ids(self) -> frozenset[int]:
        return frozenset(self._fresh)

    def snapshot(self) -> dict[str, Any]:
        active = self.active_records()
        return {
            "available": self.available,
            "presence": len(self._fresh) if self.available else None,
            "temporarily_missing": sum(
                v.confirmed and v.missing_since is not None for v in self.visits.values()
            ),
            "active_visits": active,
            "last_observed_at": self.timestamp(self.last_frame_at)
            if self.last_frame_at is not None
            else None,
            "zone_name": self.config.zone_name,
        }
