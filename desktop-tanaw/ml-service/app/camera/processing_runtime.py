from __future__ import annotations

import logging
import time
from typing import Any

import numpy as np

from app.camera.runtime_types import (
    DisplayFrameSnapshot,
    DisplayTrack,
    ProcessingSession,
)
from app.config.camera_config import CameraStartRequest
from app.counting.geometry import Centroid

logger = logging.getLogger(__name__)


class ProcessingRuntimeMixin:
    _processing_frame_age_ms: float | None
    _processing_frames_skipped: int
    _latest_stream_jpeg: bytes | None
    _latest_stream_frame_id: int

    def __getattr__(self, name: str) -> Any:
        raise AttributeError(name)

    def _processing_loop(self, session: ProcessingSession) -> None:
        config = session.config
        if not self._is_current_session(session):
            return

        last_processed_frame_id = 0
        frame_interval = 1.0 / self._processing_fps(config)
        last_cleanup_at = time.monotonic()

        try:
            self._tracker.warmup()
            while not session.stop_event.is_set() and self._is_current_session(session):
                if time.monotonic() - last_cleanup_at >= 3600:
                    self._visitor_registry.cleanup_expired()
                    last_cleanup_at = time.monotonic()

                frame, frame_id, captured_at = self._wait_for_latest_frame(
                    session, last_processed_frame_id
                )
                if frame is None:
                    continue

                started_at = time.monotonic()
                tracks = self._detect_and_count(
                    session,
                    frame,
                    config.tracking_confidence,
                    config.counting_confidence,
                )
                skipped_frames = max(0, frame_id - last_processed_frame_id - 1)
                last_processed_frame_id = frame_id

                with self._lock:
                    if not self._is_current_session_locked(session):
                        return
                    self._latest_tracks = tracks
                    self._state.status = "running"
                    self._state.error = None
                    self._processing_frames_skipped += skipped_frames
                    if captured_at is not None:
                        self._processing_frame_age_ms = max(
                            0.0, (started_at - captured_at) * 1000.0
                        )

                elapsed = time.monotonic() - started_at
                # If capture advanced while inference was running, prioritize the freshest
                # frame over nominal pacing so live overlays do not drift behind the video.
                remaining = 0.0 if skipped_frames > 0 else frame_interval - elapsed
                if remaining > 0:
                    session.stop_event.wait(remaining)
        except Exception as exc:
            self._set_session_error(session, str(exc))
        finally:
            with self._lock:
                if self._is_current_session_locked(session):
                    self._state.running = False
                if self._is_current_session_locked(session) and self._state.status != "error":
                    self._state.status = "stopped"

    def _stream_encoding_loop(self, session: ProcessingSession) -> None:
        config = session.config
        if not self._is_current_session(session):
            return

        last_encoded_raw_frame_id = 0
        frame_interval = 1.0 / max(config.stream_fps, 1.0)

        try:
            while not session.stop_event.is_set() and self._is_current_session(session):
                frame_snapshot = self._next_display_frame_snapshot(
                    session, last_encoded_raw_frame_id, timeout=1.0
                )
                if frame_snapshot is None:
                    continue

                (
                    frame,
                    raw_frame_id,
                    tracks,
                    tripwire_position,
                    entry_line,
                    exit_line,
                    roi,
                    reverse_direction,
                    entry_count,
                    exit_count,
                    occupancy_count,
                ) = frame_snapshot

                started_at = time.monotonic()
                display_frame = self._render_display_frame(
                    frame, tracks, tripwire_position, entry_line, exit_line, roi, reverse_direction
                )
                encoded = self._encode_frame(display_frame)

                with self._raw_frame_condition:
                    if not self._is_current_session_locked(session):
                        return
                    self._latest_stream_jpeg = encoded
                    self._latest_stream_frame_id += 1
                    last_encoded_raw_frame_id = raw_frame_id
                    self._raw_frame_condition.notify_all()

                elapsed = time.monotonic() - started_at
                remaining = frame_interval - elapsed
                if remaining > 0:
                    session.stop_event.wait(remaining)
        except Exception as exc:
            self._set_session_error(session, str(exc))

    def _next_display_frame_snapshot(
        self, session: ProcessingSession, last_encoded_raw_frame_id: int, timeout: float
    ) -> DisplayFrameSnapshot | None:
        with self._raw_frame_condition:
            self._raw_frame_condition.wait_for(
                lambda: (
                    session.stop_event.is_set()
                    or not self._is_current_session_locked(session)
                    or self._latest_raw_frame_id > last_encoded_raw_frame_id
                ),
                timeout=timeout,
            )

            if (
                session.stop_event.is_set()
                or not self._is_current_session_locked(session)
                or self._latest_raw_frame is None
                or self._latest_raw_frame_id <= last_encoded_raw_frame_id
            ):
                return None

            counts = self._counter.counts
            return (
                self._latest_raw_frame.copy(),
                self._latest_raw_frame_id,
                list(self._latest_tracks),
                self._counter.tripwire_position,
                self._counter.entry_line,
                self._counter.exit_line,
                session.config.roi,
                self._counter.reverse_direction,
                counts.entry,
                counts.exit,
                counts.occupancy,
            )

    def _wait_for_latest_frame(
        self, session: ProcessingSession, last_processed_frame_id: int
    ) -> tuple[np.ndarray | None, int, float | None]:
        with self._raw_frame_condition:
            self._raw_frame_condition.wait_for(
                lambda: (
                    session.stop_event.is_set()
                    or not self._is_current_session_locked(session)
                    or self._latest_raw_frame_id > last_processed_frame_id
                ),
                timeout=1.0,
            )

            if (
                session.stop_event.is_set()
                or not self._is_current_session_locked(session)
                or self._latest_raw_frame is None
            ):
                return None, last_processed_frame_id, None

            return (
                self._latest_raw_frame.copy(),
                self._latest_raw_frame_id,
                self._latest_raw_frame_captured_at,
            )

    def _detect_and_count(
        self,
        session: ProcessingSession,
        frame: np.ndarray,
        tracking_confidence: float,
        counting_confidence: float | None = None,
    ) -> list[DisplayTrack]:
        counting_confidence = (
            counting_confidence if counting_confidence is not None else tracking_confidence
        )
        frame_height, frame_width = frame.shape[:2]
        now = time.monotonic()
        self._apply_reid_results(session, now)
        self._flush_pending_entry_events(session, now)
        source_tracks = self._tracker.track_people(frame, tracking_confidence)
        if not self._is_current_session(session):
            return []
        tracks = self._identity_resolver.resolve(source_tracks, now, frame_width, frame_height)

        display_tracks: list[DisplayTrack] = []
        self._counter.begin_frame(now)
        self._appearance_buffer.begin_frame(self._counter.frame_index)
        self._quality_appearance_buffer.begin_frame(self._counter.frame_index)

        for track in tracks:
            if not self._is_current_session(session):
                return []
            counting_confidence_passed = track.confidence >= counting_confidence

            inside_roi = self._track_inside_roi(
                track.counting_point,
                track.centroid,
                track.bbox,
                frame_width,
                frame_height,
                session.config,
            )
            if not counting_confidence_passed:
                continue

            counting_eligible = inside_roi and counting_confidence_passed
            if counting_eligible and self._reid_sampling_enabled(session.config):
                self._schedule_track_embedding(
                    session, frame, track, frame_width, frame_height, now
                )
            directions = (
                self._counter.update_many(
                    track.track_id, track.counting_point, frame_width, frame_height, track.bbox
                )
                if counting_eligible
                else []
            )
            visitor_decision = None
            visitor_id = self._visitor_registry.visitor_id_for_track(track.track_id)
            pending_unique_entry = False
            for direction in directions:
                event_decision = None
                if direction == "entry":
                    event_decision = self._resolve_or_queue_unique_entry(session, track, now)
                    if event_decision is None:
                        pending_unique_entry = True
                        continue
                    visitor_decision = event_decision
                    visitor_id = event_decision.visitor_id
                self._persist_count_event(session, track, direction, event_decision)
            display_tracks.append(
                DisplayTrack(
                    track_id=track.track_id,
                    source_track_id=track.source_track_id,
                    bbox=track.bbox,
                    confidence=track.confidence,
                    centroid=(int(track.centroid.x), int(track.centroid.y)),
                    trigger_point=(int(track.counting_point.x), int(track.counting_point.y)),
                    direction=directions[-1] if directions else None,
                    visitor_id=visitor_id,
                    is_unique_entry=visitor_decision.is_unique_entry if visitor_decision else None,
                    reid_score=visitor_decision.reid_score if visitor_decision else None,
                    reid_decision=visitor_decision.reid_decision
                    if visitor_decision
                    else ("pending" if pending_unique_entry else None),
                    identity_confidence=visitor_decision.identity_confidence
                    if visitor_decision
                    else ("pending" if pending_unique_entry else None),
                    inside_roi=inside_roi,
                    counting_eligible=counting_eligible,
                    identity_state=track.identity_state,
                    identity_score=track.identity_score,
                    identity_source=track.identity_source,
                    counting_debug=self._counting_debug(
                        track.track_id,
                        inside_roi=inside_roi,
                        counting_confidence_passed=counting_confidence_passed,
                        tracking_confidence=tracking_confidence,
                        counting_confidence=counting_confidence,
                    ),
                )
            )

        for source_track in source_tracks:
            if source_track.track_id > 0 or source_track.confidence < counting_confidence:
                continue
            inside_roi = self._track_inside_roi(
                source_track.counting_point,
                source_track.centroid,
                source_track.bbox,
                frame_width,
                frame_height,
                session.config,
            )
            display_tracks.append(
                DisplayTrack(
                    track_id=source_track.track_id,
                    source_track_id=source_track.track_id,
                    bbox=source_track.bbox,
                    confidence=source_track.confidence,
                    centroid=(int(source_track.centroid.x), int(source_track.centroid.y)),
                    trigger_point=(
                        int(source_track.counting_point.x),
                        int(source_track.counting_point.y),
                    ),
                    inside_roi=inside_roi,
                    counting_eligible=False,
                    identity_state="unconfirmed",
                    identity_source="detector",
                )
            )

        return display_tracks

    def _point_inside_roi(
        self, point: Centroid, frame_width: int, frame_height: int, config: CameraStartRequest
    ) -> bool:
        roi = config.roi
        x = point.x / max(frame_width, 1)
        y = point.y / max(frame_height, 1)
        return roi.left <= x <= roi.left + roi.width and roi.top <= y <= roi.top + roi.height

    def _track_inside_roi(
        self,
        counting_point: Centroid,
        centroid: Centroid,
        bbox: tuple[int, int, int, int],
        frame_width: int,
        frame_height: int,
        config: CameraStartRequest,
    ) -> bool:
        return (
            self._point_inside_roi(counting_point, frame_width, frame_height, config)
            or self._point_inside_roi(centroid, frame_width, frame_height, config)
            or self._bbox_overlaps_roi(bbox, frame_width, frame_height, config)
        )

    def _bbox_overlaps_roi(
        self,
        bbox: tuple[int, int, int, int],
        frame_width: int,
        frame_height: int,
        config: CameraStartRequest,
    ) -> bool:
        x1, y1, x2, y2 = bbox
        box_left = max(0.0, float(min(x1, x2)))
        box_top = max(0.0, float(min(y1, y2)))
        box_right = min(float(frame_width), float(max(x1, x2)))
        box_bottom = min(float(frame_height), float(max(y1, y2)))
        box_area = max(0.0, box_right - box_left) * max(0.0, box_bottom - box_top)
        if box_area <= 0:
            return False

        roi = config.roi
        roi_left = roi.left * frame_width
        roi_top = roi.top * frame_height
        roi_right = (roi.left + roi.width) * frame_width
        roi_bottom = (roi.top + roi.height) * frame_height
        overlap_left = max(box_left, roi_left)
        overlap_top = max(box_top, roi_top)
        overlap_right = min(box_right, roi_right)
        overlap_bottom = min(box_bottom, roi_bottom)
        overlap_area = max(0.0, overlap_right - overlap_left) * max(
            0.0, overlap_bottom - overlap_top
        )

        return overlap_area / box_area >= 0.25
