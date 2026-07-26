from collections.abc import Iterable
from dataclasses import dataclass
from math import hypot
from threading import RLock

import numpy as np

from app.counting.geometry import Centroid
from app.detection.yolo_detector import TrackResult


@dataclass(frozen=True)
class ResolvedTrack:
    track_id: int
    source_track_id: int
    bbox: tuple[int, int, int, int]
    confidence: float
    centroid: Centroid
    counting_point: Centroid
    identity_state: str
    identity_score: float | None
    identity_source: str


@dataclass(frozen=True)
class EmbeddingResolution:
    track_id: int
    remap_from: int | None = None
    remap_to: int | None = None
    swapped: bool = False
    swap_from: int | None = None
    swap_to: int | None = None
    record_sample: bool = True


@dataclass
class PendingActiveSwap:
    candidate_track_id: int
    observations: int
    last_observed_at: float


@dataclass
class StableTrack:
    track_id: int
    source_track_id: int
    bbox: tuple[int, int, int, int]
    centroid: Centroid
    velocity_x: float
    velocity_y: float
    last_seen_at: float
    appearance: np.ndarray | None = None
    appearance_samples: int = 0
    quality_appearance: np.ndarray | None = None
    quality_appearance_samples: int = 0
    active: bool = True
    identity_state: str = "new"
    identity_score: float | None = None
    identity_source: str = "detector"


class TrackIdentityResolver:
    def __init__(
        self,
        lost_track_ttl_seconds: float = 2.5,
        max_spatial_distance_fraction: float = 0.18,
        max_jump_distance_fraction: float = 0.30,
        appearance_match_threshold: float = 0.76,
        appearance_margin: float = 0.05,
        appearance_track_ttl_seconds: float = 15.0,
        appearance_max_spatial_distance_fraction: float = 0.60,
        active_swap_confirmation_samples: int = 3,
        active_swap_confirmation_window_seconds: float = 5.0,
    ) -> None:
        self.lost_track_ttl_seconds = lost_track_ttl_seconds
        self.max_spatial_distance_fraction = max_spatial_distance_fraction
        self.max_jump_distance_fraction = max_jump_distance_fraction
        self.appearance_match_threshold = appearance_match_threshold
        self.appearance_margin = appearance_margin
        self.appearance_track_ttl_seconds = max(
            appearance_track_ttl_seconds, lost_track_ttl_seconds
        )
        self.appearance_max_spatial_distance_fraction = appearance_max_spatial_distance_fraction
        self.active_swap_confirmation_samples = max(2, active_swap_confirmation_samples)
        self.active_swap_confirmation_window_seconds = active_swap_confirmation_window_seconds
        self._next_track_id = 0
        self._source_to_stable: dict[int, int] = {}
        self._tracks: dict[int, StableTrack] = {}
        self._aliases: dict[int, int] = {}
        self._pending_active_swaps: dict[int, PendingActiveSwap] = {}
        self._frame_diagonal = 1.0
        self._stitch_count = 0
        self._split_count = 0
        self._active_swap_count = 0
        self._lock = RLock()

    def reset(self) -> None:
        with self._lock:
            self._next_track_id = 0
            self._source_to_stable.clear()
            self._tracks.clear()
            self._aliases.clear()
            self._pending_active_swaps.clear()
            self._frame_diagonal = 1.0
            self._stitch_count = 0
            self._split_count = 0
            self._active_swap_count = 0

    def status(self) -> dict[str, int]:
        with self._lock:
            return {
                "identity_active_tracks": sum(1 for state in self._tracks.values() if state.active),
                "identity_stitches": self._stitch_count,
                "identity_splits": self._split_count,
                "identity_active_swaps": self._active_swap_count,
                "identity_pending_swaps": len(self._pending_active_swaps),
            }

    def resolve(
        self,
        tracks: list[TrackResult],
        now: float,
        frame_width: int,
        frame_height: int,
    ) -> list[ResolvedTrack]:
        with self._lock:
            return self._resolve_locked(tracks, now, frame_width, frame_height)

    def _resolve_locked(
        self,
        tracks: list[TrackResult],
        now: float,
        frame_width: int,
        frame_height: int,
    ) -> list[ResolvedTrack]:
        diagonal = max(hypot(frame_width, frame_height), 1.0)
        self._frame_diagonal = diagonal
        self._expire_tracks(now)
        for track_state in self._tracks.values():
            track_state.active = False

        matched_stable_ids: set[int] = set()
        resolved: list[ResolvedTrack] = []
        pending: list[TrackResult] = []

        for track in tracks:
            if track.track_id <= 0:
                continue
            stable_id = self._canonical(self._source_to_stable.get(track.track_id))
            state: StableTrack | None = (
                self._tracks.get(stable_id) if stable_id is not None else None
            )
            if state is None or stable_id in matched_stable_ids:
                pending.append(track)
                continue

            predicted = self._predicted_centroid(state, now)
            jump_fraction = _distance(predicted, track.centroid) / diagonal
            if jump_fraction > self.max_jump_distance_fraction:
                self._source_to_stable.pop(track.track_id, None)
                self._split_count += 1
                pending.append(track)
                continue

            self._update_state(state, track, now, "tracked", 1.0, "source")
            matched_stable_ids.add(state.track_id)
            resolved.append(self._resolved(track, state))

        for track in pending:
            candidate, score = self._best_spatial_candidate(
                track, now, diagonal, matched_stable_ids
            )
            if candidate is None:
                candidate = self._new_stable_track(track, now)
            else:
                self._stitch_count += 1
                self._update_state(candidate, track, now, "stitched", score, "motion")

            self._source_to_stable[track.track_id] = candidate.track_id
            matched_stable_ids.add(candidate.track_id)
            resolved.append(self._resolved(track, candidate))

        resolved.sort(key=lambda item: item.source_track_id)
        return resolved

    def record_embedding(
        self,
        source_track_id: int,
        stable_track_id: int,
        embedding: np.ndarray,
        now: float,
        appearance_space: str = "fast",
    ) -> EmbeddingResolution | None:
        with self._lock:
            return self._record_embedding_locked(
                source_track_id,
                stable_track_id,
                embedding,
                now,
                appearance_space,
            )

    def _record_embedding_locked(
        self,
        source_track_id: int,
        stable_track_id: int,
        embedding: np.ndarray,
        now: float,
        appearance_space: str,
    ) -> EmbeddingResolution | None:
        normalized = _normalize(embedding)
        if normalized is None:
            return None
        if appearance_space not in {"fast", "quality"}:
            raise ValueError(f"Unsupported appearance space: {appearance_space}")

        current_id = self._canonical(stable_track_id)
        mapped_id = self._canonical(self._source_to_stable.get(source_track_id))
        if mapped_id is not None and mapped_id != current_id:
            return None
        current = self._tracks.get(current_id) if current_id is not None else None
        if current is None:
            return None

        candidate, candidate_score, second_score = self._best_appearance_candidate(
            current.track_id, normalized, now, appearance_space
        )
        current_appearance = self._appearance(current, appearance_space)
        current_score = (
            float(current_appearance @ normalized) if current_appearance is not None else None
        )
        if (
            candidate is not None
            and candidate_score >= self.appearance_match_threshold
            and candidate_score - second_score >= self.appearance_margin
        ):
            if (
                candidate.active
                and current_appearance is not None
                and current_score is not None
                and candidate_score - current_score >= self.appearance_margin
            ):
                if not self._confirm_active_swap(current, candidate, now):
                    current.identity_state = "swap_pending"
                    current.identity_score = candidate_score
                    current.identity_source = f"appearance_{appearance_space}"
                    return EmbeddingResolution(
                        track_id=current.track_id,
                        record_sample=False,
                    )
                self._swap_active_tracks(current, candidate)
                candidate.identity_state = "reidentified"
                candidate.identity_score = candidate_score
                candidate.identity_source = f"appearance_{appearance_space}"
                self._split_count += 1
                self._active_swap_count += 1
                self._update_appearance(candidate, normalized, appearance_space)
                return EmbeddingResolution(
                    track_id=candidate.track_id,
                    swapped=True,
                    swap_from=current.track_id,
                    swap_to=candidate.track_id,
                )
            if candidate.active:
                self._pending_active_swaps.pop(current.track_id, None)
                self._update_appearance(current, normalized, appearance_space)
                return EmbeddingResolution(track_id=current.track_id)

            previous_id = current.track_id
            target_id = candidate.track_id
            self._merge_track(previous_id, target_id, source_track_id, now)
            current = self._tracks[target_id]
            current.identity_state = "reidentified"
            current.identity_score = candidate_score
            current.identity_source = f"appearance_{appearance_space}"
            self._stitch_count += 1
            self._pending_active_swaps.pop(previous_id, None)
            self._update_appearance(current, normalized, appearance_space)
            return EmbeddingResolution(
                track_id=target_id,
                remap_from=previous_id,
                remap_to=target_id,
            )

        self._pending_active_swaps.pop(current.track_id, None)
        self._update_appearance(current, normalized, appearance_space)
        if current.identity_source == "detector":
            current.identity_state = "confirmed"
            current.identity_score = 1.0
            current.identity_source = f"appearance_{appearance_space}"
        return EmbeddingResolution(track_id=current.track_id)

    def canonical_track_id(self, track_id: int) -> int:
        with self._lock:
            return self._canonical(track_id) or track_id

    def canonical_track_ids(self, track_ids: Iterable[int]) -> frozenset[int]:
        with self._lock:
            return frozenset(self._canonical(track_id) or track_id for track_id in track_ids)

    def _best_spatial_candidate(
        self,
        track: TrackResult,
        now: float,
        diagonal: float,
        matched_stable_ids: set[int],
    ) -> tuple[StableTrack | None, float | None]:
        best: StableTrack | None = None
        best_score = -1.0
        for state in self._tracks.values():
            if state.track_id in matched_stable_ids:
                continue
            age = now - state.last_seen_at
            if age < 0 or age > self.lost_track_ttl_seconds:
                continue

            predicted = self._predicted_centroid(state, now)
            distance_fraction = _distance(predicted, track.centroid) / diagonal
            if distance_fraction > self.max_spatial_distance_fraction:
                continue

            iou = _bbox_iou(_shifted_bbox(state, predicted), track.bbox)
            distance_score = 1.0 - distance_fraction / self.max_spatial_distance_fraction
            score = distance_score * 0.72 + iou * 0.28
            if score > best_score:
                best = state
                best_score = score

        return best, best_score if best is not None else None

    def _best_appearance_candidate(
        self,
        current_track_id: int,
        embedding: np.ndarray,
        now: float,
        appearance_space: str,
    ) -> tuple[StableTrack | None, float, float]:
        matches: list[tuple[float, StableTrack]] = []
        for state in self._tracks.values():
            appearance = self._appearance(state, appearance_space)
            if state.track_id == current_track_id or appearance is None:
                continue
            if now - state.last_seen_at > self.appearance_track_ttl_seconds:
                continue
            current = self._tracks.get(current_track_id)
            if (
                current is not None
                and not state.active
                and _distance(state.centroid, current.centroid) / self._frame_diagonal
                > self.appearance_max_spatial_distance_fraction
            ):
                continue
            matches.append((float(appearance @ embedding), state))

        if not matches:
            return None, -1.0, -1.0

        matches.sort(key=lambda item: item[0], reverse=True)
        second_score = matches[1][0] if len(matches) > 1 else -1.0
        return matches[0][1], matches[0][0], second_score

    def _new_stable_track(self, track: TrackResult, now: float) -> StableTrack:
        self._next_track_id += 1
        state = StableTrack(
            track_id=self._next_track_id,
            source_track_id=track.track_id,
            bbox=track.bbox,
            centroid=track.centroid,
            velocity_x=0.0,
            velocity_y=0.0,
            last_seen_at=now,
        )
        self._tracks[state.track_id] = state
        self._source_to_stable[track.track_id] = state.track_id
        return state

    def _update_state(
        self,
        state: StableTrack,
        track: TrackResult,
        now: float,
        identity_state: str,
        identity_score: float | None,
        identity_source: str,
    ) -> None:
        elapsed = max(now - state.last_seen_at, 1e-3)
        measured_velocity_x = (track.centroid.x - state.centroid.x) / elapsed
        measured_velocity_y = (track.centroid.y - state.centroid.y) / elapsed
        state.velocity_x = state.velocity_x * 0.65 + measured_velocity_x * 0.35
        state.velocity_y = state.velocity_y * 0.65 + measured_velocity_y * 0.35
        state.source_track_id = track.track_id
        state.bbox = track.bbox
        state.centroid = track.centroid
        state.last_seen_at = now
        state.active = True
        if identity_state == "tracked" and state.appearance is not None:
            state.identity_state = "confirmed"
            state.identity_score = 1.0
            state.identity_source = "appearance"
        else:
            state.identity_state = identity_state
            state.identity_score = identity_score
            state.identity_source = identity_source
        self._source_to_stable[track.track_id] = state.track_id

    def _merge_track(
        self, previous_id: int, target_id: int, source_track_id: int, now: float
    ) -> None:
        previous = self._tracks.get(previous_id)
        target = self._tracks.get(target_id)
        if previous is None or target is None:
            return

        target.source_track_id = source_track_id
        target.bbox = previous.bbox
        target.centroid = previous.centroid
        target.velocity_x = previous.velocity_x
        target.velocity_y = previous.velocity_y
        target.last_seen_at = now
        target.active = True
        self._source_to_stable[source_track_id] = target_id
        self._aliases[previous_id] = target_id
        del self._tracks[previous_id]

    def _swap_active_tracks(self, current: StableTrack, candidate: StableTrack) -> None:
        current_source = current.source_track_id
        candidate_source = candidate.source_track_id
        spatial_fields = ("bbox", "centroid", "velocity_x", "velocity_y", "last_seen_at", "active")
        current_values = {field: getattr(current, field) for field in spatial_fields}
        for field in spatial_fields:
            setattr(current, field, getattr(candidate, field))
            setattr(candidate, field, current_values[field])
        current.source_track_id = candidate_source
        candidate.source_track_id = current_source
        self._source_to_stable[current_source] = candidate.track_id
        self._source_to_stable[candidate_source] = current.track_id

    def _confirm_active_swap(
        self, current: StableTrack, candidate: StableTrack, now: float
    ) -> bool:
        pending = self._pending_active_swaps.get(current.track_id)
        if (
            pending is None
            or pending.candidate_track_id != candidate.track_id
            or now - pending.last_observed_at > self.active_swap_confirmation_window_seconds
        ):
            self._pending_active_swaps[current.track_id] = PendingActiveSwap(
                candidate_track_id=candidate.track_id,
                observations=1,
                last_observed_at=now,
            )
            return False

        pending.observations += 1
        pending.last_observed_at = now
        if pending.observations < self.active_swap_confirmation_samples:
            return False

        self._pending_active_swaps.pop(current.track_id, None)
        self._pending_active_swaps.pop(candidate.track_id, None)
        return True

    @staticmethod
    def _appearance(state: StableTrack, appearance_space: str) -> np.ndarray | None:
        return state.quality_appearance if appearance_space == "quality" else state.appearance

    def _update_appearance(
        self, state: StableTrack, embedding: np.ndarray, appearance_space: str
    ) -> None:
        appearance_attribute = (
            "quality_appearance" if appearance_space == "quality" else "appearance"
        )
        samples_attribute = (
            "quality_appearance_samples" if appearance_space == "quality" else "appearance_samples"
        )
        appearance = getattr(state, appearance_attribute)
        samples = getattr(state, samples_attribute)
        if appearance is None:
            setattr(state, appearance_attribute, embedding)
            setattr(state, samples_attribute, 1)
            return

        count = min(samples, 8)
        updated = _normalize((appearance * count + embedding) / (count + 1))
        if updated is not None:
            setattr(state, appearance_attribute, updated)
            setattr(state, samples_attribute, count + 1)

    def _predicted_centroid(self, state: StableTrack, now: float) -> Centroid:
        elapsed = min(max(now - state.last_seen_at, 0.0), self.lost_track_ttl_seconds)
        return Centroid(
            state.centroid.x + state.velocity_x * elapsed,
            state.centroid.y + state.velocity_y * elapsed,
        )

    def _expire_tracks(self, now: float) -> None:
        expired = [
            track_id
            for track_id, state in self._tracks.items()
            if now - state.last_seen_at
            > max(self.lost_track_ttl_seconds * 2.0, self.appearance_track_ttl_seconds)
        ]
        for track_id in expired:
            del self._tracks[track_id]
            self._pending_active_swaps.pop(track_id, None)
        for source_id, stable_id in list(self._source_to_stable.items()):
            if self._canonical(stable_id) not in self._tracks:
                del self._source_to_stable[source_id]

    def _canonical(self, track_id: int | None) -> int | None:
        if track_id is None:
            return None
        while track_id in self._aliases:
            track_id = self._aliases[track_id]
        return track_id

    def _resolved(self, track: TrackResult, state: StableTrack) -> ResolvedTrack:
        return ResolvedTrack(
            track_id=state.track_id,
            source_track_id=track.track_id,
            bbox=track.bbox,
            confidence=track.confidence,
            centroid=track.centroid,
            counting_point=track.counting_point,
            identity_state=state.identity_state,
            identity_score=state.identity_score,
            identity_source=state.identity_source,
        )


def _distance(first: Centroid, second: Centroid) -> float:
    return hypot(second.x - first.x, second.y - first.y)


def _normalize(embedding: np.ndarray) -> np.ndarray | None:
    value = np.asarray(embedding, dtype=np.float32).reshape(-1)
    norm = float(np.linalg.norm(value))
    if norm <= 1e-9:
        return None
    return (value / norm).astype(np.float32)


def _shifted_bbox(state: StableTrack, predicted: Centroid) -> tuple[int, int, int, int]:
    delta_x = predicted.x - state.centroid.x
    delta_y = predicted.y - state.centroid.y
    x1, y1, x2, y2 = state.bbox
    return (
        int(x1 + delta_x),
        int(y1 + delta_y),
        int(x2 + delta_x),
        int(y2 + delta_y),
    )


def _bbox_iou(first: tuple[int, int, int, int], second: tuple[int, int, int, int]) -> float:
    left = max(first[0], second[0])
    top = max(first[1], second[1])
    right = min(first[2], second[2])
    bottom = min(first[3], second[3])
    intersection = max(0, right - left) * max(0, bottom - top)
    if intersection <= 0:
        return 0.0
    first_area = max(0, first[2] - first[0]) * max(0, first[3] - first[1])
    second_area = max(0, second[2] - second[0]) * max(0, second[3] - second[1])
    union = first_area + second_area - intersection
    return intersection / union if union > 0 else 0.0
