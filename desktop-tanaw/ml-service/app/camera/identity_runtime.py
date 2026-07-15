from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any, cast

import numpy as np

from app.camera.runtime_types import (
    PendingEntryEvent,
    ProcessingSession,
)
from app.identity import VisitorDecision
from app.tracking import ResolvedTrack

logger = logging.getLogger(__name__)


class IdentityRuntimeMixin:
    def __getattr__(self, name: str) -> Any:
        raise AttributeError(name)

    def _schedule_track_embedding(
        self,
        session: ProcessingSession,
        frame: np.ndarray,
        track: ResolvedTrack,
        frame_width: int,
        frame_height: int,
        now: float,
    ) -> None:
        frame_index = self._counter.frame_index
        sample_fast = self._fast_reid_enabled() and self._appearance_buffer.should_sample(
            track, frame_width, frame_height, frame_index
        )
        sample_quality = (
            self._quality_reid_enabled()
            and self._quality_appearance_buffer.should_sample(
                track, frame_width, frame_height, frame_index
            )
        )
        if not sample_fast and not sample_quality:
            return

        crop = self._crop_track(frame, track.bbox)
        if crop is None:
            return

        quality = self._appearance_buffer.quality_score(track, frame_width, frame_height)
        if sample_fast:
            submitted = self._reid_worker.submit(
                session_id=session.session_id,
                track_id=track.track_id,
                source_track_id=track.source_track_id,
                crop=crop,
                quality=quality,
                requested_at=now,
            )
            if submitted:
                self._appearance_buffer.mark_sample_requested(track.track_id, frame_index)

        if sample_quality:
            quality_submitted = self._quality_reid_worker.submit(
                session_id=session.session_id,
                track_id=track.track_id,
                source_track_id=track.source_track_id,
                crop=crop,
                quality=self._quality_appearance_buffer.quality_score(
                    track, frame_width, frame_height
                ),
                requested_at=now,
            )
            if quality_submitted:
                self._quality_appearance_buffer.mark_sample_requested(track.track_id, frame_index)

    def _resolve_unique_entry(
        self, session: ProcessingSession, track: ResolvedTrack
    ) -> VisitorDecision:
        embedding = self._appearance_buffer.embedding_for_track(track.track_id)
        quality_embedding = self._quality_appearance_buffer.embedding_for_track(track.track_id)

        with self._lock:
            camera_id = self._config.camera_id if self._config else None

        if not self._is_current_session(session):
            return VisitorDecision(
                visitor_id=None,
                is_unique_entry=True,
                reid_score=None,
                reid_decision="stale_session",
                identity_confidence="degraded",
                business_date=self._visitor_registry.business_date_for(datetime.now(UTC)),
            )

        return cast(
            VisitorDecision,
            self._visitor_registry.resolve_entry(
                track_id=track.track_id,
                camera_id=camera_id,
                embedding=embedding,
                quality_embedding=quality_embedding,
                detection_confidence=track.confidence,
                bbox=track.bbox,
            ),
        )

    def _resolve_or_queue_unique_entry(
        self, session: ProcessingSession, track: ResolvedTrack, now: float
    ) -> VisitorDecision | None:
        if session.config.unique_counting_mode == "entry_only":
            return self._degraded_unique_entry_decision("entry_only")

        if not self._fast_reid_enabled():
            return self._degraded_unique_entry_decision("reid_off")

        embedding = self._appearance_buffer.embedding_for_track(track.track_id)
        quality_embedding = self._quality_appearance_buffer.embedding_for_track(track.track_id)
        if embedding is not None or quality_embedding is not None:
            return self._resolve_unique_entry(session, track)

        with self._lock:
            if not self._is_current_session_locked(session):
                return self._resolve_unique_entry(session, track)

            key = (session.session_id, track.track_id)
            if key not in self._pending_entry_events:
                self._pending_entry_events[key] = PendingEntryEvent(
                    session_id=session.session_id,
                    track=track,
                    direction="entry",
                    created_at=now,
                    expires_at=now + session.config.pending_reid_wait_seconds,
                )
                self._persist_session_locked()
        return None

    def _degraded_unique_entry_decision(self, reason: str) -> VisitorDecision:
        return VisitorDecision(
            visitor_id=None,
            is_unique_entry=True,
            reid_score=None,
            reid_decision=reason,
            identity_confidence="degraded",
            business_date=self._visitor_registry.business_date_for(datetime.now(UTC)),
        )

    def _flush_pending_entry_events(
        self, session: ProcessingSession, now: float, force: bool = False
    ) -> None:
        ready_events: list[PendingEntryEvent] = []
        with self._lock:
            for key, event in list(self._pending_entry_events.items()):
                if event.session_id != session.session_id:
                    del self._pending_entry_events[key]
                    continue
                embedding = self._appearance_buffer.embedding_for_track(event.track.track_id)
                quality_embedding = self._quality_appearance_buffer.embedding_for_track(
                    event.track.track_id
                )
                if (
                    force
                    or embedding is not None
                    or quality_embedding is not None
                    or now >= event.expires_at
                ):
                    ready_events.append(event)
                    del self._pending_entry_events[key]

        for event in ready_events:
            if not self._is_current_session(session):
                continue
            visitor_decision = self._resolve_unique_entry(session, event.track)
            self._persist_count_event(session, event.track, event.direction, visitor_decision)

    def _apply_reid_results(self, session: ProcessingSession, now: float) -> None:
        for result in self._reid_worker.poll(session.session_id):
            if result.embedding is None:
                continue
            canonical_track_id = self._identity_resolver.canonical_track_id(result.track_id)
            resolution = self._identity_resolver.record_embedding(
                result.source_track_id,
                canonical_track_id,
                result.embedding,
                now,
            )
            if resolution is None:
                continue
            self._appearance_buffer.record_sample(
                resolution.track_id,
                result.embedding,
                result.quality,
                self._counter.frame_index,
            )
            if resolution.remap_from is None or resolution.remap_to is None:
                continue
            self._counter.remap_track(resolution.remap_from, resolution.remap_to)
            self._appearance_buffer.remap_track(resolution.remap_from, resolution.remap_to)
            self._quality_appearance_buffer.remap_track(resolution.remap_from, resolution.remap_to)
            self._visitor_registry.remap_session_track(resolution.remap_from, resolution.remap_to)

        for result in self._quality_reid_worker.poll(session.session_id):
            if result.embedding is None:
                continue
            track_id = self._identity_resolver.canonical_track_id(result.track_id)
            self._quality_appearance_buffer.record_sample(
                track_id,
                result.embedding,
                result.quality,
                self._counter.frame_index,
            )
            self._visitor_registry.record_quality_embedding_for_track(track_id, result.embedding)

    def _crop_track(self, frame: np.ndarray, bbox: tuple[int, int, int, int]) -> np.ndarray | None:
        frame_height, frame_width = frame.shape[:2]
        x1, y1, x2, y2 = bbox
        x1 = max(0, min(frame_width - 1, x1))
        y1 = max(0, min(frame_height - 1, y1))
        x2 = max(0, min(frame_width, x2))
        y2 = max(0, min(frame_height, y2))
        if x2 <= x1 or y2 <= y1:
            return None
        return frame[y1:y2, x1:x2].copy()
