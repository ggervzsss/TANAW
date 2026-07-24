from __future__ import annotations

from dataclasses import dataclass
from statistics import mean

import numpy as np

from app.counting.tripwire_counter import TripwireCounter
from app.reid import (
    PersonReIdentifier,
    ReIdReplayMode,
    TrackAppearanceBuffer,
    get_reid_model_profile,
    missing_reid_models,
)
from app.tracking import ResolvedTrack, TrackIdentityResolver


@dataclass(frozen=True)
class PendingEmbedding:
    track_id: int
    source_track_id: int
    embedding: np.ndarray
    quality: float


class ReplayReIdCoordinator:
    """Deterministic, one-frame-delayed equivalent of the live ReID workers."""

    def __init__(self, mode: ReIdReplayMode) -> None:
        missing = missing_reid_models(mode)
        if missing:
            names = ", ".join(profile.filename for profile in missing)
            raise RuntimeError(
                f"ReID mode {mode!r} requires missing model assets: {names}. "
                "Run `npm run models:setup:reid` from desktop-tanaw."
            )

        self.mode = mode
        self.fast = (
            PersonReIdentifier.from_profile(get_reid_model_profile("fast"))
            if mode in {"fast", "quality"}
            else None
        )
        self.quality = (
            PersonReIdentifier.from_profile(get_reid_model_profile("quality"))
            if mode == "quality"
            else None
        )
        self.fast_buffer = TrackAppearanceBuffer()
        self.quality_buffer = TrackAppearanceBuffer(
            max_samples_per_track=2,
            min_detection_confidence=0.60,
            min_bbox_height_px=96,
            max_edge_clip_fraction=0.25,
            stop_when_full=True,
        )
        self._pending_fast: list[PendingEmbedding] = []
        self._pending_quality: list[PendingEmbedding] = []
        self._fast_inference_ms: list[float] = []
        self._quality_inference_ms: list[float] = []
        self._failed_samples = 0
        self._remaps = 0

        if self.fast is not None:
            self.fast.warmup()
            self._require_ready(self.fast, "fast")
        if self.quality is not None:
            self.quality.warmup()
            self._require_ready(self.quality, "quality")

    def begin_frame(
        self,
        resolver: TrackIdentityResolver,
        counter: TripwireCounter,
        frame_index: int,
        now: float,
    ) -> None:
        for pending in self._pending_fast:
            canonical_track_id = resolver.canonical_track_id(pending.track_id)
            resolution = resolver.record_embedding(
                pending.source_track_id,
                canonical_track_id,
                pending.embedding,
                now,
            )
            if resolution is None:
                continue
            self.fast_buffer.record_sample(
                resolution.track_id,
                pending.embedding,
                pending.quality,
                frame_index,
            )
            if resolution.remap_from is None or resolution.remap_to is None:
                continue
            counter.remap_track(resolution.remap_from, resolution.remap_to)
            self.fast_buffer.remap_track(resolution.remap_from, resolution.remap_to)
            self.quality_buffer.remap_track(resolution.remap_from, resolution.remap_to)
            self._remaps += 1

        for pending in self._pending_quality:
            track_id = resolver.canonical_track_id(pending.track_id)
            self.quality_buffer.record_sample(
                track_id,
                pending.embedding,
                pending.quality,
                frame_index,
            )

        self._pending_fast = []
        self._pending_quality = []
        self.fast_buffer.begin_frame(frame_index)
        self.quality_buffer.begin_frame(frame_index)

    def sample_tracks(
        self,
        frame: np.ndarray,
        tracks: list[ResolvedTrack],
        frame_index: int,
        frame_width: int,
        frame_height: int,
    ) -> None:
        if self.fast is None:
            return

        for track in tracks:
            sample_fast = self.fast_buffer.should_sample(
                track, frame_width, frame_height, frame_index
            )
            sample_quality = self.quality is not None and self.quality_buffer.should_sample(
                track, frame_width, frame_height, frame_index
            )
            if not sample_fast and not sample_quality:
                continue
            crop = _crop(frame, track.bbox)
            if crop is None:
                self._failed_samples += 1
                continue

            if sample_fast:
                quality = self.fast_buffer.quality_score(track, frame_width, frame_height)
                result = self.fast.embed_crop(crop)
                if result is None:
                    self._failed_samples += 1
                else:
                    self.fast_buffer.mark_sample_requested(track.track_id, frame_index)
                    self._fast_inference_ms.append(result.inference_ms)
                    self._pending_fast.append(
                        PendingEmbedding(
                            track_id=track.track_id,
                            source_track_id=track.source_track_id,
                            embedding=result.embedding,
                            quality=quality,
                        )
                    )

            if sample_quality and self.quality is not None:
                quality = self.quality_buffer.quality_score(track, frame_width, frame_height)
                result = self.quality.embed_crop(crop)
                if result is None:
                    self._failed_samples += 1
                else:
                    self.quality_buffer.mark_sample_requested(track.track_id, frame_index)
                    self._quality_inference_ms.append(result.inference_ms)
                    self._pending_quality.append(
                        PendingEmbedding(
                            track_id=track.track_id,
                            source_track_id=track.source_track_id,
                            embedding=result.embedding,
                            quality=quality,
                        )
                    )

    def status(self) -> dict[str, int | float | str | None]:
        return {
            "mode": self.mode,
            "fast_model": self.fast.model_name if self.fast is not None else None,
            "quality_model": self.quality.model_name if self.quality is not None else None,
            "fast_samples": len(self._fast_inference_ms),
            "quality_samples": len(self._quality_inference_ms),
            "failed_samples": self._failed_samples,
            "identity_remaps": self._remaps,
            "fast_average_inference_ms": (
                mean(self._fast_inference_ms) if self._fast_inference_ms else None
            ),
            "quality_average_inference_ms": (
                mean(self._quality_inference_ms) if self._quality_inference_ms else None
            ),
        }

    @staticmethod
    def _require_ready(reidentifier: PersonReIdentifier, profile: str) -> None:
        status = reidentifier.status()
        if status["reid_model_ready"]:
            return
        raise RuntimeError(
            f"The {profile} ReID model could not be initialized: {status['reid_error']}"
        )


def _crop(frame: np.ndarray, bbox: tuple[int, int, int, int]) -> np.ndarray | None:
    frame_height, frame_width = frame.shape[:2]
    x1, y1, x2, y2 = bbox
    x1 = max(0, min(frame_width - 1, x1))
    y1 = max(0, min(frame_height - 1, y1))
    x2 = max(0, min(frame_width, x2))
    y2 = max(0, min(frame_height, y2))
    if x2 <= x1 or y2 <= y1:
        return None
    return frame[y1:y2, x1:x2].copy()
