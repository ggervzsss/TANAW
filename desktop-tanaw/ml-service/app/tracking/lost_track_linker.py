"""Reconnect a person who reappears after a short occlusion to the track they had before.

The detector's tracker gives a person a new track when they are hidden for too long. A daily
visitor match then has to recognise them from appearance alone, against everyone seen today,
with a strict score. Here the search is far narrower: only tracks that disappeared moments
earlier, close to where the new track appeared, and that were never in view at the same time
as it. Within that small set a looser appearance score is safe.
"""

from dataclasses import dataclass
from math import hypot

import numpy as np


@dataclass
class _TrackMemory:
    first_seen: float
    last_seen: float
    first_position: tuple[float, float]
    last_position: tuple[float, float]
    embedding: np.ndarray | None = None
    has_successor: bool = False
    link_decided: bool = False


class LostTrackLinker:
    def __init__(
        self,
        match_threshold: float = 0.65,
        match_margin: float = 0.05,
        max_gap_seconds: float = 10.0,
        base_distance: float = 0.12,
        distance_per_second: float = 0.05,
        max_distance: float = 0.45,
    ) -> None:
        """Distances are fractions of the frame, measured on normalized coordinates."""
        self.match_threshold = match_threshold
        self.match_margin = match_margin
        self.max_gap_seconds = max_gap_seconds
        self.base_distance = base_distance
        self.distance_per_second = distance_per_second
        self.max_distance = max_distance
        self._tracks: dict[int, _TrackMemory] = {}

    def reset(self) -> None:
        self._tracks.clear()

    def observe(self, positions: dict[int, tuple[float, float]], now: float) -> None:
        """Record the tracks visible in this frame at their normalized positions."""
        for track_id, position in positions.items():
            if track_id <= 0:
                continue
            memory = self._tracks.get(track_id)
            if memory is None:
                self._tracks[track_id] = _TrackMemory(now, now, position, position)
            else:
                memory.last_seen = now
                memory.last_position = position
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

    def needs_link_decision(self, track_id: int) -> bool:
        memory = self._tracks.get(track_id)
        return memory is not None and not memory.link_decided

    def link(self, track_id: int, embedding: np.ndarray | None) -> int | None:
        """Decide once whether this track resumed a lost one; returns that track's ID."""
        memory = self._tracks.get(track_id)
        normalized = _normalize(embedding)
        if memory is None or memory.link_decided or normalized is None:
            return None
        memory.link_decided = True
        scored: list[tuple[float, int]] = []
        for candidate_id, candidate in self._tracks.items():
            if candidate_id == track_id or candidate.has_successor or candidate.embedding is None:
                continue
            # A track seen while this one was already visible is a different person.
            gap = memory.first_seen - candidate.last_seen
            if gap <= 0 or gap > self.max_gap_seconds:
                continue
            allowed = min(self.max_distance, self.base_distance + self.distance_per_second * gap)
            if _distance(candidate.last_position, memory.first_position) > allowed:
                continue
            scored.append((float(candidate.embedding @ normalized), candidate_id))
        if not scored:
            return None
        scored.sort(reverse=True)
        best_score, best_id = scored[0]
        second_score = scored[1][0] if len(scored) > 1 else -1.0
        if best_score < self.match_threshold or best_score - second_score < self.match_margin:
            return None
        self._tracks[best_id].has_successor = True
        return best_id


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
