"""Reconnect a person who reappears after a short occlusion to the track they had before.

The detector's tracker gives a person a new track when they are hidden for too long. A daily
visitor match then has to recognise them from appearance alone, against everyone seen today,
with a strict score. Here the search is far narrower: only tracks that disappeared moments
earlier, close to where the new track appeared, and that were never in view at the same time
as it. Within that small set a looser appearance score is safe.

People who walk out of the frame and others who walk in are not occlusions. A track that
vanished while moving through the frame edge, or one that came in through it, is never
linked. A box merely touching the edge is not enough: with a high camera, people close to
it are cut off at the top or bottom while standing still or being hidden.
"""

from collections import deque
from collections.abc import Collection, Mapping
from dataclasses import dataclass, field
from math import hypot

import numpy as np

# Sides of the frame a box can touch.
EDGE_SIDES = frozenset({"left", "right", "top", "bottom"})


@dataclass
class _TrackMemory:
    first_seen: float
    last_seen: float
    first_position: tuple[float, float]
    last_position: tuple[float, float]
    first_edges: frozenset[str] = frozenset()
    last_edges: frozenset[str] = frozenset()
    # Recent (time, position) pairs, for the direction a track was moving when it vanished.
    recent: deque[tuple[float, tuple[float, float]]] = field(
        default_factory=lambda: deque(maxlen=32)
    )
    embedding: np.ndarray | None = None
    # When the track first had a trusted appearance; link attempts are timed from then.
    embedding_since: float | None = None
    has_successor: bool = False
    linked: bool = False


class LostTrackLinker:
    def __init__(
        self,
        match_threshold: float = 0.65,
        single_candidate_threshold: float = 0.70,
        match_margin: float = 0.05,
        max_gap_seconds: float = 10.0,
        base_distance: float = 0.12,
        distance_per_second: float = 0.05,
        max_distance: float = 0.45,
        decision_window_seconds: float = 5.0,
        edge_motion_seconds: float = 1.0,
        min_edge_motion: float = 0.04,
        flicker_seconds: float = 1.0,
        flicker_distance: float = 0.05,
    ) -> None:
        """Distances are fractions of the frame, measured on normalized coordinates.

        With a single candidate there is no rival to beat, so its score must clear the
        stricter ``single_candidate_threshold``. A new track keeps trying to link for
        ``decision_window_seconds`` after its appearance is first trusted, as it improves;
        in a crowd that can be well after the track appeared. A track moved through an edge
        when it travelled at least ``min_edge_motion`` towards a side it touched within
        ``edge_motion_seconds`` of vanishing, or away from one after appearing; a box cut off
        by the frame jitters, so only walking-pace motion counts. A track replaced within
        ``flicker_seconds`` at nearly the same spot (``flicker_distance``) is a tracker
        flicker, not someone leaving and another arriving.
        """
        self.edge_motion_seconds = edge_motion_seconds
        self.min_edge_motion = min_edge_motion
        self.flicker_seconds = flicker_seconds
        self.flicker_distance = flicker_distance
        self.match_threshold = match_threshold
        self.single_candidate_threshold = max(match_threshold, single_candidate_threshold)
        self.decision_window_seconds = decision_window_seconds
        self.match_margin = match_margin
        self.max_gap_seconds = max_gap_seconds
        self.base_distance = base_distance
        self.distance_per_second = distance_per_second
        self.max_distance = max_distance
        self._tracks: dict[int, _TrackMemory] = {}

    def reset(self) -> None:
        self._tracks.clear()

    def observe(
        self,
        positions: dict[int, tuple[float, float]],
        now: float,
        edges: Mapping[int, Collection[str]] | None = None,
    ) -> None:
        """Record the tracks visible in this frame at their normalized positions.

        ``edges`` names, per track, the sides of the frame its box touches.
        """
        for track_id, position in positions.items():
            if track_id <= 0:
                continue
            sides = frozenset((edges or {}).get(track_id, ())) & EDGE_SIDES
            memory = self._tracks.get(track_id)
            if memory is None:
                memory = _TrackMemory(
                    now, now, position, position, first_edges=sides, last_edges=sides
                )
                self._tracks[track_id] = memory
            else:
                memory.last_seen = now
                memory.last_position = position
                memory.last_edges = sides
            memory.recent.append((now, position))
        horizon = self.max_gap_seconds * 2.0
        self._tracks = {
            track_id: memory
            for track_id, memory in self._tracks.items()
            if now - memory.last_seen <= horizon
        }

    def remember_appearance(self, track_id: int, embedding: np.ndarray | None) -> None:
        memory = self._tracks.get(track_id)
        normalized = _normalize(embedding)
        if memory is not None and normalized is not None:
            memory.embedding = normalized
            if memory.embedding_since is None:
                memory.embedding_since = memory.last_seen

    def needs_link_decision(self, track_id: int, now: float) -> bool:
        """Whether this track is new enough, and not yet linked, to look for its past."""
        memory = self._tracks.get(track_id)
        return (
            memory is not None
            and not memory.linked
            and memory.embedding_since is not None
            and now - memory.embedding_since <= self.decision_window_seconds
        )

    def link(self, track_id: int, embedding: np.ndarray | None) -> int | None:
        """Whether this track resumed a lost one; returns that track's ID.

        A failed attempt may be retried with a better embedding while the track is new.
        """
        memory = self._tracks.get(track_id)
        normalized = _normalize(embedding)
        if memory is None or memory.linked or normalized is None:
            return None
        entered = self._entered_through_edge(memory)
        scored: list[tuple[float, int]] = []
        for candidate_id, candidate in self._tracks.items():
            if candidate_id == track_id or candidate.has_successor or candidate.embedding is None:
                continue
            # A track seen while this one was already visible is a different person.
            gap = memory.first_seen - candidate.last_seen
            if gap <= 0 or gap > self.max_gap_seconds:
                continue
            distance = _distance(candidate.last_position, memory.first_position)
            allowed = min(self.max_distance, self.base_distance + self.distance_per_second * gap)
            if distance > allowed:
                continue
            flicker = gap <= self.flicker_seconds and distance <= self.flicker_distance
            if not flicker and (entered or self._left_through_edge(candidate)):
                continue
            scored.append((float(candidate.embedding @ normalized), candidate_id))
        if not scored:
            return None
        scored.sort(reverse=True)
        best_score, best_id = scored[0]
        if len(scored) == 1:
            if best_score < self.single_candidate_threshold:
                return None
        elif best_score < self.match_threshold or best_score - scored[1][0] < self.match_margin:
            return None
        self._tracks[best_id].has_successor = True
        memory.linked = True
        return best_id

    def _entered_through_edge(self, memory: _TrackMemory) -> bool:
        """Whether the track appeared at a side and then moved inwards, away from it.

        Until the track has been watched long enough to tell, it counts as entering, so the
        link attempt waits.
        """
        if not memory.first_edges:
            return False
        later = next(
            (
                position
                for at, position in memory.recent
                if at - memory.first_seen >= self.edge_motion_seconds
            ),
            None,
        )
        if later is None:
            return True
        return any(
            _towards(side, memory.first_position, later) <= -self.min_edge_motion
            for side in memory.first_edges
        )

    def _left_through_edge(self, memory: _TrackMemory) -> bool:
        """Whether the track vanished at a side while moving towards it."""
        if not memory.last_edges:
            return False
        earlier = next(
            (
                position
                for at, position in memory.recent
                if memory.last_seen - at <= self.edge_motion_seconds
            ),
            memory.last_position,
        )
        return any(
            _towards(side, earlier, memory.last_position) >= self.min_edge_motion
            for side in memory.last_edges
        )


def _towards(side: str, start: tuple[float, float], end: tuple[float, float]) -> float:
    """How far a move from ``start`` to ``end`` went towards one side of the frame."""
    dx, dy = end[0] - start[0], end[1] - start[1]
    return {"left": -dx, "right": dx, "top": -dy, "bottom": dy}[side]


def _distance(first: tuple[float, float], second: tuple[float, float]) -> float:
    return hypot(second[0] - first[0], second[1] - first[1])


def _normalize(embedding: np.ndarray | None) -> np.ndarray | None:
    if embedding is None:
        return None
    value = np.asarray(embedding, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(value))
    if not value.size or not np.isfinite(norm) or norm <= 1e-9:
        return None
    return (value / norm).astype(np.float32)
