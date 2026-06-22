from dataclasses import dataclass, field
from typing import Protocol

import numpy as np

from app.counting.geometry import Centroid


class TrackLike(Protocol):
    @property
    def track_id(self) -> int: ...

    @property
    def bbox(self) -> tuple[int, int, int, int]: ...

    @property
    def confidence(self) -> float: ...

    @property
    def centroid(self) -> Centroid: ...

    @property
    def counting_point(self) -> Centroid: ...


@dataclass(frozen=True)
class AppearanceSample:
    embedding: np.ndarray
    quality: float
    frame_index: int


@dataclass
class TrackAppearance:
    last_seen_frame: int
    last_sampled_frame: int = 0
    samples: list[AppearanceSample] = field(default_factory=list)


class TrackAppearanceBuffer:
    def __init__(
        self,
        max_samples_per_track: int = 5,
        sample_interval_frames: int = 4,
        track_ttl_frames: int = 90,
        min_detection_confidence: float = 0.45,
        min_bbox_height_px: int = 80,
        max_edge_clip_fraction: float = 0.30,
        stop_when_full: bool = False,
    ) -> None:
        self.max_samples_per_track = max_samples_per_track
        self.sample_interval_frames = sample_interval_frames
        self.track_ttl_frames = track_ttl_frames
        self.min_detection_confidence = min_detection_confidence
        self.min_bbox_height_px = min_bbox_height_px
        self.max_edge_clip_fraction = max_edge_clip_fraction
        self.stop_when_full = stop_when_full
        self._tracks: dict[int, TrackAppearance] = {}

    def begin_frame(self, frame_index: int) -> None:
        stale_before_frame = frame_index - self.track_ttl_frames
        for track_id, state in list(self._tracks.items()):
            if state.last_seen_frame < stale_before_frame:
                del self._tracks[track_id]

    def should_sample(
        self, track: TrackLike, frame_width: int, frame_height: int, frame_index: int
    ) -> bool:
        if track.track_id <= 0:
            return False
        if track.confidence < self.min_detection_confidence:
            return False

        quality = self.quality_score(track, frame_width, frame_height)
        if quality <= 0:
            return False

        state = self._tracks.setdefault(
            track.track_id, TrackAppearance(last_seen_frame=frame_index)
        )
        state.last_seen_frame = frame_index
        if self.stop_when_full and len(state.samples) >= self.max_samples_per_track:
            return False
        if (
            state.last_sampled_frame
            and frame_index - state.last_sampled_frame < self.sample_interval_frames
        ):
            return False

        return True

    def record_sample(
        self, track_id: int, embedding: np.ndarray, quality: float, frame_index: int
    ) -> None:
        if track_id <= 0:
            return

        state = self._tracks.setdefault(track_id, TrackAppearance(last_seen_frame=frame_index))
        state.last_seen_frame = frame_index
        state.last_sampled_frame = frame_index
        state.samples.append(
            AppearanceSample(
                embedding=embedding.astype(np.float32), quality=quality, frame_index=frame_index
            )
        )
        state.samples.sort(key=lambda sample: (sample.quality, sample.frame_index), reverse=True)
        state.samples = state.samples[: self.max_samples_per_track]

    def mark_sample_requested(self, track_id: int, frame_index: int) -> None:
        if track_id <= 0:
            return
        state = self._tracks.setdefault(track_id, TrackAppearance(last_seen_frame=frame_index))
        state.last_seen_frame = frame_index
        state.last_sampled_frame = frame_index

    def remap_track(self, previous_track_id: int, target_track_id: int) -> None:
        if previous_track_id == target_track_id:
            return
        previous = self._tracks.pop(previous_track_id, None)
        if previous is None:
            return
        target = self._tracks.get(target_track_id)
        if target is None:
            self._tracks[target_track_id] = previous
            return
        target.last_seen_frame = max(target.last_seen_frame, previous.last_seen_frame)
        target.last_sampled_frame = max(target.last_sampled_frame, previous.last_sampled_frame)
        target.samples.extend(previous.samples)
        target.samples.sort(key=lambda sample: (sample.quality, sample.frame_index), reverse=True)
        target.samples = target.samples[: self.max_samples_per_track]

    def embedding_for_track(self, track_id: int) -> np.ndarray | None:
        state = self._tracks.get(track_id)
        if state is None or not state.samples:
            return None

        weights = np.array(
            [max(sample.quality, 1e-6) for sample in state.samples], dtype=np.float32
        )
        embeddings = np.stack([sample.embedding for sample in state.samples]).astype(np.float32)
        weighted = np.average(embeddings, axis=0, weights=weights)
        norm = float(np.linalg.norm(weighted))
        if norm <= 1e-9:
            return None
        return (weighted / norm).astype(np.float32)

    def quality_score(self, track: TrackLike, frame_width: int, frame_height: int) -> float:
        x1, y1, x2, y2 = track.bbox
        bbox_width = max(0, x2 - x1)
        bbox_height = max(0, y2 - y1)
        if bbox_height < self.min_bbox_height_px or bbox_width <= 0:
            return 0.0

        horizontal_clip = 0
        if x1 <= 0:
            horizontal_clip += 1
        if x2 >= frame_width:
            horizontal_clip += 1
        vertical_clip = 0
        if y1 <= 0:
            vertical_clip += 1
        if y2 >= frame_height:
            vertical_clip += 1
        clip_fraction = (horizontal_clip + vertical_clip) / 4.0
        if clip_fraction > self.max_edge_clip_fraction:
            return 0.0

        size_score = min(1.0, bbox_height / max(float(frame_height) * 0.45, 1.0))
        return float(track.confidence * 0.65 + size_score * 0.35)
