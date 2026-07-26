import logging
import os
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

os.environ.setdefault("OPENCV_FFMPEG_LOGLEVEL", "16")
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")

import cv2
import numpy as np

from app.camera.auth import build_authenticated_stream_url, redact_stream_credentials
from app.camera.stream_reader import open_capture, validate_stream
from app.config.camera_config import CameraStartRequest, RegionOfInterest, TripwireLine
from app.counting.geometry import Centroid
from app.counting.tripwire_counter import TripwireCounter
from app.detection.yolo_detector import YoloPersonTracker
from app.identity import UniqueVisitorRegistry, VisitorDecision
from app.reid import (
    AsyncReIdWorker,
    PersonReIdentifier,
    TrackAppearanceBuffer,
    get_reid_model_availability,
    get_reid_model_profile,
)
from app.runtime.hardware import get_runtime_capabilities
from app.storage.session_store import SessionStore
from app.tracking import EmbeddingResolution, ResolvedTrack, TrackIdentityResolver

NormalizedPath = tuple[tuple[float, float], ...]

logger = logging.getLogger(__name__)
RECONNECT_MAX_DELAY_SECONDS = 15.0
FAST_REID_RESULT_MAX_AGE_SECONDS = 2.5
QUALITY_REID_RESULT_MAX_AGE_SECONDS = 6.0


class CameraStreamUnavailableError(ValueError):
    pass


@dataclass
class RuntimeState:
    running: bool = False
    status: str = "stopped"
    error: str | None = None


@dataclass(frozen=True)
class DisplayTrack:
    track_id: int
    source_track_id: int
    bbox: tuple[int, int, int, int]
    confidence: float
    centroid: tuple[int, int]
    trigger_point: tuple[int, int]
    direction: str | None = None
    visitor_id: str | None = None
    is_unique_entry: bool | None = None
    reid_score: float | None = None
    reid_decision: str | None = None
    identity_confidence: str | None = None
    inside_roi: bool | None = None
    counting_eligible: bool | None = None
    identity_state: str | None = None
    identity_score: float | None = None
    identity_source: str | None = None
    counting_debug: dict[str, Any] | None = None


DisplayFrameSnapshot = tuple[
    np.ndarray,
    int,
    list[DisplayTrack],
    float,
    NormalizedPath | None,
    NormalizedPath | None,
    RegionOfInterest,
    bool,
    int,
    int,
    int,
]


@dataclass(frozen=True)
class ProcessingSession:
    session_id: int
    config: CameraStartRequest
    stop_event: threading.Event
    event_scope: str = ""


@dataclass(frozen=True)
class PendingEntryEvent:
    session_id: int
    track: ResolvedTrack
    direction: str
    created_at: float
    expires_at: float


class CameraProcessingManager:
    def __init__(self, app_data_dir: str | None = None, camera_id: int | None = None) -> None:
        self._app_data_dir = app_data_dir
        self._camera_id_scope = camera_id
        self._lock = threading.RLock()
        self._active_session: ProcessingSession | None = None
        self._next_session_id = 0
        self._processing_thread: threading.Thread | None = None
        self._reader_thread: threading.Thread | None = None
        self._stream_thread: threading.Thread | None = None
        self._raw_frame_condition = threading.Condition(self._lock)
        self._latest_raw_frame: np.ndarray | None = None
        self._latest_raw_frame_id = 0
        self._latest_raw_frame_captured_at: float | None = None
        self._latest_processed_at: float | None = None
        self._latest_stream_encoded_at: float | None = None
        self._latest_jpeg: bytes | None = None
        self._latest_stream_jpeg: bytes | None = None
        self._latest_stream_frame_id = 0
        self._latest_processed_frame: np.ndarray | None = None
        self._latest_processed_frame_id = 0
        self._latest_tracks: list[DisplayTrack] = []
        self._state = RuntimeState()
        self._config: CameraStartRequest | None = None
        self._counter = TripwireCounter()
        self._tracker = YoloPersonTracker()
        self._reidentifier = PersonReIdentifier.from_profile(get_reid_model_profile("fast"))
        self._reid_worker = AsyncReIdWorker(self._reidentifier)
        self._quality_reidentifier = PersonReIdentifier.from_profile(
            get_reid_model_profile("quality")
        )
        self._quality_reid_worker = AsyncReIdWorker(self._quality_reidentifier, max_queue_size=4)
        self._appearance_buffer = TrackAppearanceBuffer()
        self._quality_appearance_buffer = TrackAppearanceBuffer(
            max_samples_per_track=2,
            min_detection_confidence=0.60,
            min_bbox_height_px=96,
            max_edge_clip_fraction=0.25,
            stop_when_full=True,
        )
        self._identity_resolver = TrackIdentityResolver()
        self._pending_entry_events: dict[tuple[int, int], PendingEntryEvent] = {}
        self._session_store = SessionStore(app_data_dir, camera_id=camera_id)
        self._visitor_registry = UniqueVisitorRegistry(
            self._session_store,
            model_name=self._reidentifier.model_name,
            quality_model_name=self._quality_reidentifier.model_name,
        )
        self._session_updated_at: str | None = None
        self._restoring_session = False
        self._effective_profile = "emergency"
        self._effective_reid_mode = "fast"
        self._processing_frame_age_ms: float | None = None
        self._processing_frames_skipped = 0
        self._reid_results_stale = 0
        self._enterprise_id: str | None = None
        self._enterprise_name: str | None = None

    @property
    def running(self) -> bool:
        with self._lock:
            return self._state.running

    def test_connection(
        self,
        stream_url: str,
        username: str | None = None,
        password: str | None = None,
    ) -> tuple[bool, str]:
        try:
            config = CameraStartRequest(
                stream_url=stream_url,
                username=username,
                password=password,
            )
        except Exception as exc:
            return False, redact_stream_credentials(str(exc))

        return self._validate_config_stream(config)

    def bind_enterprise(
        self,
        enterprise_id: str,
        enterprise_name: str | None = None,
        *,
        restore_session: bool = True,
    ) -> dict:
        normalized_id = enterprise_id.strip()
        normalized_name = enterprise_name.strip() if enterprise_name else None
        with self._lock:
            if self._enterprise_id == normalized_id:
                if normalized_name:
                    self._enterprise_name = normalized_name
                return {
                    "enterprise_id": normalized_id,
                    "enterprise_name": self._enterprise_name,
                    "changed": False,
                    "session_restored": False,
                }
            should_stop_previous_context = (
                self._enterprise_id is not None
                or self._active_session is not None
                or self._config is not None
            )

        if should_stop_previous_context:
            self.stop()
        with self._lock:
            self._enterprise_id = normalized_id
            self._enterprise_name = normalized_name
            self._session_store = SessionStore(
                self._app_data_dir, normalized_id, self._camera_id_scope
            )
            self._visitor_registry = UniqueVisitorRegistry(
                self._session_store,
                model_name=self._reidentifier.model_name,
                quality_model_name=self._quality_reidentifier.model_name,
            )
            self._state = RuntimeState()
            self._config = None
            self._session_updated_at = None
        restored = self.restore_last_session() if restore_session else False
        return {
            "enterprise_id": normalized_id,
            "enterprise_name": normalized_name,
            "changed": True,
            "session_restored": restored,
        }

    def start(self, config: CameraStartRequest) -> None:
        if config.camera_id is None:
            raise ValueError("Camera ID is required to start camera processing.")
        if self._camera_id_scope is not None and config.camera_id != self._camera_id_scope:
            raise ValueError("Camera configuration does not match this camera pipeline.")
        self.stop()
        with self._raw_frame_condition:
            self._config = config
            self._state = RuntimeState(running=True, status="starting", error=None)
            self._latest_jpeg = self._build_status_frame("Checking camera stream...")
            self._latest_stream_jpeg = self._latest_jpeg
            self._latest_stream_frame_id += 1
            self._persist_session_locked()
            self._raw_frame_condition.notify_all()

        ok, message = self._validate_config_stream(config)
        if not ok:
            with self._raw_frame_condition:
                self._state = RuntimeState(running=False, status="failed", error=message)
                self._latest_jpeg = self._build_status_frame(message)
                self._latest_stream_jpeg = self._latest_jpeg
                self._latest_stream_frame_id += 1
                self._persist_session_locked()
                self._raw_frame_condition.notify_all()
            raise CameraStreamUnavailableError(message)

        saved_snapshot = self._session_store.load_session()

        with self._lock:
            self._effective_profile = self._tracker.configure(
                config.processing_profile, config.runtime_backend, config.tracker_profile
            )
            self._configure_reid_locked(config)
            processing_fps = self._processing_fps(config)
            self._config = config
            self._counter = TripwireCounter(
                tripwire_position=config.tripwire_position,
                entry_line=self._normalized_line(config.entry_line),
                exit_line=self._normalized_line(config.exit_line),
                reverse_direction=config.reverse_direction,
                event_cooldown_frames=_seconds_to_frames(
                    config.event_cooldown_seconds, processing_fps
                ),
                track_ttl_frames=_seconds_to_frames(config.track_ttl_seconds, processing_fps),
                event_cooldown_seconds=config.event_cooldown_seconds,
                track_ttl_seconds=config.track_ttl_seconds,
                paired_line_max_gap_frames=_seconds_to_frames(
                    config.paired_line_max_gap_seconds, processing_fps
                ),
                paired_line_max_gap_seconds=config.paired_line_max_gap_seconds,
            )
            self._counter.reset()
            self._restore_saved_snapshot(saved_snapshot)
            self._appearance_buffer = TrackAppearanceBuffer(
                sample_interval_frames=max(1, int(round(processing_fps)))
            )
            self._quality_appearance_buffer = TrackAppearanceBuffer(
                max_samples_per_track=2,
                sample_interval_frames=max(1, int(round(processing_fps * 4.0))),
                track_ttl_frames=max(1, int(round(processing_fps * 15.0))),
                min_detection_confidence=0.60,
                min_bbox_height_px=96,
                max_edge_clip_fraction=0.25,
                stop_when_full=True,
            )
            self._identity_resolver = TrackIdentityResolver(
                lost_track_ttl_seconds=min(config.track_ttl_seconds, 3.0),
                appearance_track_ttl_seconds=max(config.track_ttl_seconds, 15.0),
            )
            self._pending_entry_events.clear()
            self._visitor_registry.prepare(config.camera_id)
            self._visitor_registry.reset_session_tracks()
            self._processing_frame_age_ms = None
            self._processing_frames_skipped = 0
            self._reid_results_stale = 0
            self._latest_jpeg = self._build_status_frame("Initializing ML model...")
            self._latest_stream_jpeg = self._latest_jpeg
            self._latest_stream_frame_id += 1
            # Starting is an active lifecycle state. Publishing it before model
            # warmup lets the collection runtime endpoint represent startup and
            # makes capacity accounting include in-flight pipelines.
            self._state = RuntimeState(running=True, status="starting", error=None)
            self._persist_session_locked()

        try:
            self._tracker.warmup()
            if self._fast_reid_enabled():
                self._reidentifier.warmup()
            if self._quality_reid_enabled():
                self._quality_reidentifier.warmup()
        except Exception as exc:
            safe_message = redact_stream_credentials(f"Unable to initialize ML model: {exc}")
            with self._raw_frame_condition:
                self._state = RuntimeState(running=False, status="failed", error=safe_message)
                self._latest_jpeg = self._build_status_frame(safe_message)
                self._latest_stream_jpeg = self._latest_jpeg
                self._latest_stream_frame_id += 1
                self._persist_session_locked()
                self._raw_frame_condition.notify_all()
            raise RuntimeError(safe_message) from exc

        with self._lock:
            self._next_session_id += 1
            session = ProcessingSession(
                session_id=self._next_session_id,
                config=config,
                stop_event=threading.Event(),
                event_scope=uuid4().hex,
            )
            self._reid_worker.begin_session(session.session_id)
            self._quality_reid_worker.begin_session(session.session_id)
            self._tracker.reset_tracking()
            self._identity_resolver.reset()
            self._active_session = session
            self._config = config
            self._latest_jpeg = self._build_status_frame("Starting camera processing...")
            self._latest_stream_jpeg = self._latest_jpeg
            self._latest_stream_frame_id = 0
            self._state = RuntimeState(running=True, status="connecting", error=None)
            self._latest_raw_frame = None
            self._latest_raw_frame_id = 0
            self._latest_raw_frame_captured_at = None
            self._latest_processed_at = None
            self._latest_stream_encoded_at = None
            self._latest_processed_frame = None
            self._latest_processed_frame_id = 0
            self._latest_tracks = []
            self._reader_thread = threading.Thread(
                target=self._capture_loop,
                args=(session,),
                name=f"tanaw-camera-{config.camera_id}-reader",
                daemon=True,
            )
            self._processing_thread = threading.Thread(
                target=self._processing_loop,
                args=(session,),
                name=f"tanaw-camera-{config.camera_id}-processing",
                daemon=True,
            )
            self._stream_thread = threading.Thread(
                target=self._stream_encoding_loop,
                args=(session,),
                name=f"tanaw-camera-{config.camera_id}-stream-encoder",
                daemon=True,
            )
            self._reader_thread.start()
            self._processing_thread.start()
            self._stream_thread.start()
            self._persist_session_locked()

    def stop(self) -> None:
        threads: list[threading.Thread]
        session: ProcessingSession | None
        with self._lock:
            session = self._active_session
            threads = [
                thread
                for thread in (self._reader_thread, self._processing_thread, self._stream_thread)
                if thread is not None
            ]
            if session is not None:
                session.stop_event.set()
                self._flush_pending_entry_events(session, time.monotonic(), force=True)
            self._active_session = None
            self._raw_frame_condition.notify_all()

        for thread in threads:
            if thread is threading.current_thread():
                continue
            if thread.is_alive():
                thread.join(timeout=5)
            if thread.is_alive():
                logger.warning("Camera thread %s did not stop cleanly.", thread.name)

        if session is not None:
            self._reid_worker.end_session(session.session_id)
            self._quality_reid_worker.end_session(session.session_id)

        with self._lock:
            self._reader_thread = None
            self._processing_thread = None
            self._stream_thread = None
            self._latest_raw_frame = None
            self._latest_raw_frame_id = 0
            self._latest_raw_frame_captured_at = None
            self._latest_processed_at = None
            self._latest_stream_encoded_at = None
            self._latest_processed_frame = None
            self._latest_processed_frame_id = 0
            self._latest_tracks = []
            self._pending_entry_events.clear()
            self._latest_jpeg = self._build_status_frame("Camera processing stopped.")
            self._latest_stream_jpeg = self._latest_jpeg
            self._latest_stream_frame_id += 1
            self._state.running = False
            if self._state.status not in {"error", "failed"}:
                self._state.status = "stopped"
            if self._enterprise_id is not None or self._config is not None:
                self._persist_session_locked()

    def counts(self) -> dict[str, int | str | bool | None]:
        with self._lock:
            snapshot = self._counter.counts.as_dict()
            running = self._state.running
            status = self._state.status
            error = redact_stream_credentials(self._state.error) if self._state.error else None
            has_enterprise_context = self._enterprise_id is not None
        if has_enterprise_context:
            snapshot["occupancy"] = self._session_store.enterprise_occupancy()
        return {
            **snapshot,
            "running": running,
            "status": status,
            "error": error,
        }

    def detections(
        self,
    ) -> dict[str, Any]:
        with self._lock:
            frame_height = None
            frame_width = None
            if self._latest_raw_frame is not None:
                frame_height, frame_width = self._latest_raw_frame.shape[:2]

            return {
                "running": self._state.running,
                "status": self._state.status,
                "error": redact_stream_credentials(self._state.error)
                if self._state.error
                else None,
                "frame_width": frame_width,
                "frame_height": frame_height,
                "tracks": [
                    {
                        "track_id": track.track_id,
                        "source_track_id": track.source_track_id,
                        "bbox": track.bbox,
                        "confidence": track.confidence,
                        "centroid": track.centroid,
                        "trigger_point": track.trigger_point,
                        "direction": track.direction,
                        "visitor_id": track.visitor_id,
                        "is_unique_entry": track.is_unique_entry,
                        "reid_score": track.reid_score,
                        "reid_decision": track.reid_decision,
                        "identity_confidence": track.identity_confidence,
                        "inside_roi": track.inside_roi,
                        "counting_eligible": track.counting_eligible,
                        "identity_state": track.identity_state,
                        "identity_score": track.identity_score,
                        "identity_source": track.identity_source,
                        "counting_debug": track.counting_debug,
                    }
                    for track in self._latest_tracks
                ],
            }

    def session(self) -> dict:
        with self._lock:
            counts = self.counts()
            return {
                "running": self._state.running,
                "status": self._state.status,
                "error": redact_stream_credentials(self._state.error)
                if self._state.error
                else None,
                "camera_id": self._config.camera_id if self._config else None,
                "camera_name": self._config.camera_name if self._config else None,
                "camera_config": self._public_config_dump() if self._config else None,
                "counts": counts,
                "updated_at": self._session_updated_at,
            }

    def list_camera_profiles(self) -> list[dict]:
        return self._session_store.list_camera_profiles()

    def replace_camera_profiles(self, cameras: list[dict]) -> list[dict]:
        return self._session_store.replace_camera_profiles(cameras)

    def metrics_summary(self, include_submitted: bool = False) -> dict:
        return self._session_store.metrics_summary(include_submitted=include_submitted)

    def metrics_history(self, include_submitted: bool = False) -> dict:
        return self._session_store.metrics_history(include_submitted=include_submitted)

    def record_occupancy_correction(
        self,
        *,
        new_occupancy: int,
        reason: str,
        actor_id: str | None = None,
        actor_name: str | None = None,
        camera_id: int | None = None,
    ) -> dict:
        with self._lock:
            old_occupancy = self._session_store.enterprise_occupancy()
            resolved_camera_id = (
                camera_id
                if camera_id is not None
                else self._config.camera_id
                if self._config
                else None
            )
        correction = self._session_store.record_occupancy_correction(
            enterprise_id=self._enterprise_id,
            camera_id=resolved_camera_id,
            old_occupancy=old_occupancy,
            new_occupancy=max(0, new_occupancy),
            reason=reason,
            actor_id=actor_id,
            actor_name=actor_name,
        )

        return correction

    def occupancy_corrections(self, limit: int = 100) -> list[dict]:
        return self._session_store.list_occupancy_corrections(limit=limit)

    def model_status(self) -> dict:
        with self._lock:
            now = time.monotonic()
            runtime_status = {
                "processing_frame_age_ms": self._processing_frame_age_ms,
                "processing_frames_skipped": self._processing_frames_skipped,
                "raw_frame_id": self._latest_raw_frame_id,
                "processed_frame_id": self._latest_processed_frame_id,
                "stream_frame_id": self._latest_stream_frame_id,
                "raw_frame_stale_ms": _age_ms(now, self._latest_raw_frame_captured_at),
                "processed_frame_stale_ms": _age_ms(now, self._latest_processed_at),
                "stream_frame_stale_ms": _age_ms(now, self._latest_stream_encoded_at),
                "reid_results_stale": self._reid_results_stale,
                "pending_unique_entries": len(self._pending_entry_events),
                "tracking_confidence": self._config.tracking_confidence if self._config else None,
                "counting_confidence": self._config.counting_confidence if self._config else None,
                "reid_mode": self._config.reid_mode if self._config else None,
                "effective_reid_mode": self._effective_reid_mode,
                "unique_counting_mode": self._config.unique_counting_mode if self._config else None,
            }
            has_local_context = self._enterprise_id is not None or self._config is not None
        summary = (
            self._session_store.metrics_summary(include_submitted=False)
            if has_local_context
            else {
                "estimated_unique_count": 0,
                "confirmed_unique_count": 0,
                "degraded_unique_count": 0,
                "repeat_entry_count": 0,
            }
        )
        quality_status = self._quality_reidentifier.status()
        quality_worker_status = self._quality_reid_worker.status()
        return {
            **self._tracker.status(),
            **self._reidentifier.status(),
            **self._reid_worker.status(),
            "quality_reid_model_loaded": quality_status["reid_model_loaded"],
            "quality_reid_model_ready": quality_status["reid_model_ready"],
            "quality_reid_model_loading": quality_status["reid_model_loading"],
            "quality_reid_status": quality_status["reid_status"],
            "quality_reid_model_path": quality_status["reid_model_path"],
            "quality_reid_error": quality_status["reid_error"],
            "quality_reid_average_inference_ms": quality_status["reid_average_inference_ms"],
            "quality_reid_providers": quality_status["reid_providers"],
            "quality_reid_queue_depth": quality_worker_status["reid_queue_depth"],
            "quality_reid_tasks_pending": quality_worker_status["reid_tasks_pending"],
            "quality_reid_tasks_dropped": quality_worker_status["reid_tasks_dropped"],
            "quality_reid_tasks_cleared": quality_worker_status["reid_tasks_cleared"],
            "quality_reid_tasks_completed": quality_worker_status["reid_tasks_completed"],
            "quality_reid_worker_alive": quality_worker_status["reid_worker_alive"],
            "quality_reid_worker_p50_ms": quality_worker_status["reid_worker_p50_ms"],
            "quality_reid_worker_p95_ms": quality_worker_status["reid_worker_p95_ms"],
            **self._identity_resolver.status(),
            **self._visitor_registry.status(),
            **runtime_status,
            "estimated_unique_count": summary["estimated_unique_count"],
            "confirmed_unique_count": summary["confirmed_unique_count"],
            "degraded_unique_count": summary["degraded_unique_count"],
            "repeat_entry_count": summary["repeat_entry_count"],
            "reid_model_availability": get_reid_model_availability(),
            "runtime_capabilities": get_runtime_capabilities(),
        }

    def record_report_submission(
        self,
        report_id: str,
        period: str,
        notes: str | None = None,
        payload: dict | None = None,
        metrics: dict | None = None,
    ) -> dict:
        submission = self._session_store.record_report_submission(
            report_id=report_id,
            period=period,
            notes=notes,
            payload=payload,
            metrics=metrics,
        )
        self._visitor_registry.cleanup_expired()
        return submission

    def list_report_submissions(self, limit: int = 100) -> list[dict]:
        return self._session_store.list_report_submissions(limit=limit)

    def get_report_draft(self, draft_key: str) -> dict | None:
        return self._session_store.get_report_draft(draft_key)

    def save_report_draft(
        self,
        draft_key: str,
        period: str,
        payload: dict,
        report_id: str | None = None,
    ) -> dict:
        return self._session_store.save_report_draft(
            draft_key=draft_key,
            period=period,
            payload=payload,
            report_id=report_id,
        )

    def delete_report_draft(self, draft_key: str) -> bool:
        return self._session_store.delete_report_draft(draft_key)

    def mark_report_synced(self, report_id: str) -> bool:
        return self._session_store.mark_report_synced(report_id)

    def purge_report_raw_events(self, report_id: str) -> dict:
        return self._session_store.purge_report_raw_events(report_id)

    def mark_events_synced(self) -> int:
        return self._session_store.mark_events_synced()

    def prepare_sample_counts(
        self,
        *,
        report_id: str,
        enterprise_id: str,
        enterprise_name: str | None,
        entries: int,
        exits: int,
        unique_count: int,
        peak_occupancy: int,
        period: str,
    ) -> dict:
        with self._lock:
            if self._enterprise_id != enterprise_id:
                raise ValueError(
                    f"Desktop is bound to {self._enterprise_id or 'no enterprise'}. "
                    f"Log into {enterprise_name or enterprise_id} before preparing counts."
                )
            camera_id = self._config.camera_id if self._config else None
            camera_name = self._config.camera_name if self._config else None

        summary = self._session_store.prepare_sample_counts(
            report_id=report_id,
            entries=entries,
            exits=exits,
            unique_count=unique_count,
            peak_occupancy=peak_occupancy,
            camera_id=camera_id,
            camera_name=camera_name,
            period=period,
        )
        return {
            **summary,
            "enterprise_id": enterprise_id,
            "enterprise_name": enterprise_name,
            "period": period,
            "prepared": bool(summary.get("prepared")),
        }

    def restore_last_session(self) -> bool:
        if self.running or self._restoring_session:
            return False

        payload = self._session_store.load_session()
        if not payload or not payload.get("running"):
            self._restore_saved_snapshot(payload)
            return False

        camera_config = payload.get("camera_config")
        if not isinstance(camera_config, dict):
            self._restore_saved_snapshot(payload)
            return False
        if camera_config.get("password_redacted") or camera_config.get(
            "stream_url_credentials_redacted"
        ):
            self._restore_saved_snapshot(payload)
            return False

        try:
            config = CameraStartRequest(**camera_config)
        except Exception:
            self._restore_saved_snapshot(payload)
            return False

        self._restore_saved_snapshot(payload)
        self._restoring_session = True
        try:
            try:
                self.start(config)
                self._restore_saved_snapshot(payload)
                return True
            except Exception as exc:
                with self._raw_frame_condition:
                    self._state = RuntimeState(
                        running=False,
                        status="failed",
                        error=redact_stream_credentials(
                            f"Unable to restore monitoring session: {exc}"
                        ),
                    )
                    self._config = config
                    self._persist_session_locked()
                    self._raw_frame_condition.notify_all()
                return False
        finally:
            self._restoring_session = False

    def wait_for_stream_frame(
        self, last_frame_id: int, timeout: float = 1.0, overlay: bool = True
    ) -> tuple[bytes, int]:
        if not overlay:
            return self._wait_for_clean_stream_frame(last_frame_id, timeout)

        with self._raw_frame_condition:
            self._raw_frame_condition.wait_for(
                lambda: self._latest_stream_frame_id > last_frame_id,
                timeout=timeout,
            )

            if self._latest_stream_jpeg is not None:
                return self._latest_stream_jpeg, self._latest_stream_frame_id

            if self._latest_jpeg is not None:
                return self._latest_jpeg, last_frame_id

        return self._build_status_frame("No camera stream available."), last_frame_id

    def _wait_for_clean_stream_frame(
        self, last_frame_id: int, timeout: float = 1.0
    ) -> tuple[bytes, int]:
        frame: np.ndarray | None = None
        frame_id = last_frame_id
        fallback: bytes | None = None
        with self._raw_frame_condition:
            self._raw_frame_condition.wait_for(
                lambda: self._latest_raw_frame_id > last_frame_id,
                timeout=timeout,
            )

            if self._latest_raw_frame is not None:
                frame = self._latest_raw_frame.copy()
                frame_id = self._latest_raw_frame_id

            elif self._latest_jpeg is not None:
                fallback = self._latest_jpeg

        if frame is not None:
            return self._encode_frame(frame), frame_id
        if fallback is not None:
            return fallback, last_frame_id
        return self._build_status_frame("No camera stream available."), last_frame_id

    def _capture_loop(self, session: ProcessingSession) -> None:
        config = session.config
        if not self._is_current_session(session):
            return

        self._opencv_capture_loop(session, self._runtime_stream_url(config))

    def _validate_config_stream(self, config: CameraStartRequest) -> tuple[bool, str]:
        runtime_stream_url = self._runtime_stream_url(config)
        ok, message = validate_stream(runtime_stream_url)
        return ok, redact_stream_credentials(message)

    def _runtime_stream_url(self, config: CameraStartRequest) -> str:
        return build_authenticated_stream_url(config.stream_url, config.username, config.password)

    def _opencv_capture_loop(self, session: ProcessingSession, stream_url: str) -> None:
        config = session.config
        reconnect_attempt = 0
        while not session.stop_event.is_set() and self._is_current_session(session):
            capture = open_capture(stream_url)
            failed_reads = 0
            reconnect_message = "Camera stream could not be opened."
            try:
                if capture.isOpened():
                    while not session.stop_event.is_set() and self._is_current_session(session):
                        ok, frame = capture.read()
                        if not ok or frame is None:
                            failed_reads += 1
                            if failed_reads >= 90:
                                reconnect_message = "Camera stream stopped returning frames."
                                break
                            session.stop_event.wait(0.05)
                            continue

                        failed_reads = 0
                        reconnect_attempt = 0
                        frame = self._resize_for_processing(frame, self._max_frame_width(config))
                        self._publish_raw_frame(session, frame)
            except Exception as exc:
                reconnect_message = redact_stream_credentials(str(exc))
            finally:
                capture.release()

            if session.stop_event.is_set() or not self._is_current_session(session):
                return
            reconnect_attempt += 1
            self._mark_reconnecting(session, reconnect_message)
            if session.stop_event.wait(self._reconnect_delay(reconnect_attempt)):
                return

    def _mark_reconnecting(self, session: ProcessingSession, message: str) -> None:
        with self._raw_frame_condition:
            if not self._is_current_session_locked(session):
                return
            safe_message = redact_stream_credentials(message)
            self._state = RuntimeState(running=True, status="reconnecting", error=safe_message)
            self._latest_jpeg = self._build_status_frame("Reconnecting camera stream...")
            self._latest_stream_jpeg = self._latest_jpeg
            self._latest_stream_frame_id += 1
            self._persist_session_locked()
            self._raw_frame_condition.notify_all()
        logger.warning(
            "Camera pipeline reconnecting.",
            extra={
                "enterprise_id": self._enterprise_id,
                "camera_id": session.config.camera_id,
                "status": "reconnecting",
            },
        )

    @staticmethod
    def _reconnect_delay(attempt: int) -> float:
        return float(min(2 ** max(0, attempt - 1), RECONNECT_MAX_DELAY_SECONDS))

    def _publish_raw_frame(
        self, session: ProcessingSession, frame: np.ndarray, captured_at: float | None = None
    ) -> None:
        with self._raw_frame_condition:
            if not self._is_current_session_locked(session):
                return
            self._latest_raw_frame = frame
            self._latest_raw_frame_id += 1
            self._latest_raw_frame_captured_at = (
                captured_at if captured_at is not None else time.monotonic()
            )
            self._state.status = "running"
            self._state.error = None
            self._raw_frame_condition.notify_all()

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
                    self._latest_processed_frame = frame
                    self._latest_processed_frame_id = frame_id
                    self._latest_processed_at = time.monotonic()
                    self._latest_tracks = tracks
                    self._state.status = "running"
                    self._state.error = None
                    self._processing_frames_skipped += skipped_frames
                    if captured_at is not None:
                        self._processing_frame_age_ms = max(
                            0.0, (started_at - captured_at) * 1000.0
                        )
                    self._raw_frame_condition.notify_all()

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
                if self._is_current_session_locked(session) and self._state.status not in {
                    "error",
                    "failed",
                }:
                    self._state.status = "stopped"

    def _stream_encoding_loop(self, session: ProcessingSession) -> None:
        config = session.config
        if not self._is_current_session(session):
            return

        last_encoded_processed_frame_id = 0
        frame_interval = 1.0 / max(config.stream_fps, 1.0)

        try:
            while not session.stop_event.is_set() and self._is_current_session(session):
                frame_snapshot = self._next_display_frame_snapshot(
                    session, last_encoded_processed_frame_id, timeout=1.0
                )
                if frame_snapshot is None:
                    continue

                (
                    frame,
                    processed_frame_id,
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
                    self._latest_stream_encoded_at = time.monotonic()
                    last_encoded_processed_frame_id = processed_frame_id
                    self._raw_frame_condition.notify_all()

                elapsed = time.monotonic() - started_at
                remaining = frame_interval - elapsed
                if remaining > 0:
                    session.stop_event.wait(remaining)
        except Exception as exc:
            self._set_session_error(session, str(exc))

    def _next_display_frame_snapshot(
        self, session: ProcessingSession, last_encoded_processed_frame_id: int, timeout: float
    ) -> DisplayFrameSnapshot | None:
        with self._raw_frame_condition:
            self._raw_frame_condition.wait_for(
                lambda: (
                    session.stop_event.is_set()
                    or not self._is_current_session_locked(session)
                    or self._latest_processed_frame_id > last_encoded_processed_frame_id
                ),
                timeout=timeout,
            )

            if (
                session.stop_event.is_set()
                or not self._is_current_session_locked(session)
                or self._latest_processed_frame is None
                or self._latest_processed_frame_id <= last_encoded_processed_frame_id
            ):
                return None

            counts = self._counter.counts
            return (
                self._latest_processed_frame.copy(),
                self._latest_processed_frame_id,
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

        return self._visitor_registry.resolve_entry(
            track_id=track.track_id,
            camera_id=camera_id,
            embedding=embedding,
            quality_embedding=quality_embedding,
            detection_confidence=track.confidence,
            bbox=track.bbox,
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
            if result.embedding is None or self._reid_result_is_stale(
                result.requested_at, now, FAST_REID_RESULT_MAX_AGE_SECONDS
            ):
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
            if resolution.record_sample:
                self._appearance_buffer.record_sample(
                    resolution.track_id,
                    result.embedding,
                    result.quality,
                    self._counter.frame_index,
                )
            self._apply_identity_resolution(resolution)

        for result in self._quality_reid_worker.poll(session.session_id):
            if result.embedding is None or self._reid_result_is_stale(
                result.requested_at, now, QUALITY_REID_RESULT_MAX_AGE_SECONDS
            ):
                continue
            track_id = self._identity_resolver.canonical_track_id(result.track_id)
            resolution = self._identity_resolver.record_embedding(
                result.source_track_id,
                track_id,
                result.embedding,
                now,
                appearance_space="quality",
            )
            if resolution is None:
                continue
            if resolution.record_sample:
                self._quality_appearance_buffer.record_sample(
                    resolution.track_id,
                    result.embedding,
                    result.quality,
                    self._counter.frame_index,
                )
                self._visitor_registry.record_quality_embedding_for_track(
                    resolution.track_id, result.embedding
                )
            self._apply_identity_resolution(resolution)

    def _reid_result_is_stale(
        self, requested_at: float, now: float, max_age_seconds: float
    ) -> bool:
        if requested_at > now or now - requested_at <= max_age_seconds:
            return False
        with self._lock:
            self._reid_results_stale += 1
        return True

    def _apply_identity_resolution(self, resolution: EmbeddingResolution) -> None:
        if (
            resolution.swapped
            and resolution.swap_from is not None
            and resolution.swap_to is not None
        ):
            self._counter.swap_tracks(resolution.swap_from, resolution.swap_to)
            logger.info(
                "Confirmed active track identity swap.",
                extra={
                    "camera_id": self._config.camera_id if self._config else None,
                    "first_track_id": resolution.swap_from,
                    "second_track_id": resolution.swap_to,
                },
            )
        if resolution.remap_from is None or resolution.remap_to is None:
            return
        self._counter.remap_track(resolution.remap_from, resolution.remap_to)
        self._appearance_buffer.remap_track(resolution.remap_from, resolution.remap_to)
        self._quality_appearance_buffer.remap_track(resolution.remap_from, resolution.remap_to)
        self._visitor_registry.remap_session_track(resolution.remap_from, resolution.remap_to)
        logger.info(
            "Reattached track to an inactive identity.",
            extra={
                "camera_id": self._config.camera_id if self._config else None,
                "previous_track_id": resolution.remap_from,
                "target_track_id": resolution.remap_to,
            },
        )

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

    def _render_display_frame(
        self,
        frame: np.ndarray,
        tracks: list[DisplayTrack],
        tripwire_position: float,
        entry_line: NormalizedPath | None,
        exit_line: NormalizedPath | None,
        roi: RegionOfInterest,
        reverse_direction: bool,
    ) -> np.ndarray:
        height, width = frame.shape[:2]
        self._draw_roi(frame, roi, width, height)
        if entry_line is not None or exit_line is not None:
            self._draw_tripwire_line(frame, entry_line, width, height, "ENTRY", (74, 222, 128))
            self._draw_tripwire_line(frame, exit_line, width, height, "EXIT", (248, 113, 113))
        else:
            line_x = int(width * tripwire_position)

            cv2.line(frame, (line_x, 0), (line_x, height), (59, 130, 246), 2)
            if reverse_direction:
                cv2.putText(
                    frame,
                    "ENTRY",
                    (max(8, line_x - 70), 22),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.48,
                    (74, 222, 128),
                    1,
                    cv2.LINE_AA,
                )
                cv2.putText(
                    frame,
                    "EXIT",
                    (line_x + 10, 22),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.48,
                    (248, 113, 113),
                    1,
                    cv2.LINE_AA,
                )
            else:
                cv2.putText(
                    frame,
                    "EXIT",
                    (max(8, line_x - 54), 22),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.48,
                    (248, 113, 113),
                    1,
                    cv2.LINE_AA,
                )
                cv2.putText(
                    frame,
                    "ENTRY",
                    (line_x + 10, 22),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.48,
                    (74, 222, 128),
                    1,
                    cv2.LINE_AA,
                )

        for track in tracks:
            x1, y1, x2, y2 = track.bbox
            color = (
                (74, 222, 128)
                if track.direction == "entry"
                else (248, 113, 113)
                if track.direction == "exit"
                else (34, 197, 94)
            )

            self._draw_track_box(frame, (x1, y1, x2, y2), color)
            cv2.circle(frame, track.trigger_point, 4, (34, 211, 238), -1)
            if track.track_id > 0:
                source_suffix = (
                    f" | src {track.source_track_id}"
                    if track.source_track_id != track.track_id
                    else ""
                )
                label = f"#{track.track_id}{source_suffix}"
            else:
                label = "Person"
            self._draw_track_label(frame, x1, y1, f"{label} | {track.confidence * 100:.0f}%", color)

        return frame

    def _draw_track_box(
        self, frame: np.ndarray, bbox: tuple[int, int, int, int], color: tuple[int, int, int]
    ) -> None:
        frame_height, frame_width = frame.shape[:2]
        x1, y1, x2, y2 = bbox
        left = max(0, min(frame_width - 1, min(x1, x2)))
        top = max(0, min(frame_height - 1, min(y1, y2)))
        right = max(0, min(frame_width - 1, max(x1, x2)))
        bottom = max(0, min(frame_height - 1, max(y1, y2)))
        if right <= left or bottom <= top:
            return

        overlay = frame.copy()
        cv2.rectangle(overlay, (left, top), (right, bottom), color, -1)
        cv2.addWeighted(overlay, 0.07, frame, 0.93, 0, frame)

        shadow = (15, 23, 42)
        cv2.rectangle(frame, (left, top), (right, bottom), shadow, 1)

        width = right - left
        height = bottom - top
        corner = max(10, min(28, int(min(width, height) * 0.28)))
        thickness = 2
        line_type = cv2.LINE_AA

        cv2.line(frame, (left, top), (left + corner, top), color, thickness, line_type)
        cv2.line(frame, (left, top), (left, top + corner), color, thickness, line_type)
        cv2.line(frame, (right, top), (right - corner, top), color, thickness, line_type)
        cv2.line(frame, (right, top), (right, top + corner), color, thickness, line_type)
        cv2.line(frame, (left, bottom), (left + corner, bottom), color, thickness, line_type)
        cv2.line(frame, (left, bottom), (left, bottom - corner), color, thickness, line_type)
        cv2.line(frame, (right, bottom), (right - corner, bottom), color, thickness, line_type)
        cv2.line(frame, (right, bottom), (right, bottom - corner), color, thickness, line_type)

    def _draw_track_label(
        self, frame: np.ndarray, x: int, y: int, label: str, color: tuple[int, int, int]
    ) -> None:
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.38
        thickness = 1
        padding_x = 5
        padding_y = 3
        text_size, baseline = cv2.getTextSize(label, font, font_scale, thickness)
        text_width, text_height = text_size
        label_width = text_width + padding_x * 2
        label_height = text_height + padding_y * 2 + baseline

        frame_height, frame_width = frame.shape[:2]
        left = max(0, min(x, frame_width - label_width - 1))
        top = y - label_height - 3
        if top < 0:
            top = min(frame_height - label_height - 1, y + 3)
        top = max(0, top)
        right = min(frame_width - 1, left + label_width)
        bottom = min(frame_height - 1, top + label_height)

        overlay = frame.copy()
        cv2.rectangle(overlay, (left, top), (right, bottom), (15, 23, 42), -1)
        cv2.addWeighted(overlay, 0.78, frame, 0.22, 0, frame)
        cv2.rectangle(frame, (left, top), (right, bottom), color, 1)
        cv2.rectangle(frame, (left, top), (min(right, left + 3), bottom), color, -1)
        cv2.putText(
            frame,
            label,
            (left + padding_x, bottom - padding_y - baseline),
            font,
            font_scale,
            (255, 255, 255),
            thickness,
            cv2.LINE_AA,
        )

    def _draw_roi(
        self, frame: np.ndarray, roi: RegionOfInterest, frame_width: int, frame_height: int
    ) -> None:
        x1 = int(roi.left * frame_width)
        y1 = int(roi.top * frame_height)
        x2 = int((roi.left + roi.width) * frame_width)
        y2 = int((roi.top + roi.height) * frame_height)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (59, 130, 246), 2)
        cv2.putText(
            frame,
            "ROI",
            (x1 + 6, max(18, y1 - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            (59, 130, 246),
            1,
            cv2.LINE_AA,
        )

    def _draw_tripwire_line(
        self,
        frame: np.ndarray,
        line: NormalizedPath | None,
        frame_width: int,
        frame_height: int,
        label: str,
        color: tuple[int, int, int],
    ) -> None:
        if line is None:
            return

        points = [(int(x * frame_width), int(y * frame_height)) for x, y in line]
        if len(points) < 2:
            return

        for start, end in zip(points, points[1:], strict=False):
            cv2.line(frame, start, end, color, 2)
        cv2.circle(frame, points[0], 4, color, -1)
        cv2.circle(frame, points[-1], 4, color, -1)
        cv2.putText(
            frame,
            label,
            (points[0][0] + 6, max(18, points[0][1] - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            color,
            1,
            cv2.LINE_AA,
        )

    def _normalized_line(self, line: TripwireLine | None) -> NormalizedPath | None:
        if line is None:
            return None

        points = line.sampled_points or line.points or [line.start, line.end]
        return tuple((point.x, point.y) for point in points)

    def _resize_for_processing(self, frame: np.ndarray, max_width: int) -> np.ndarray:
        height, width = frame.shape[:2]
        if width <= max_width:
            return frame

        scale = max_width / width
        return cv2.resize(frame, (max_width, int(height * scale)), interpolation=cv2.INTER_AREA)

    def _encode_frame(self, frame: np.ndarray) -> bytes:
        ok, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
        if not ok:
            raise RuntimeError("Failed to encode processed frame.")
        return buffer.tobytes()

    def _is_current_session(self, session: ProcessingSession) -> bool:
        with self._lock:
            return self._is_current_session_locked(session)

    def _is_current_session_locked(self, session: ProcessingSession) -> bool:
        return self._active_session is session

    def _set_session_error(self, session: ProcessingSession, message: str) -> None:
        with self._raw_frame_condition:
            if not self._is_current_session_locked(session):
                return

            safe_message = redact_stream_credentials(message)
            self._state = RuntimeState(running=False, status="failed", error=safe_message)
            self._latest_jpeg = self._build_status_frame(safe_message)
            self._latest_stream_jpeg = self._latest_jpeg
            self._latest_stream_frame_id += 1
            session.stop_event.set()
            self._active_session = None
            self._persist_session_locked()
            self._raw_frame_condition.notify_all()

    def _build_status_frame(self, message: str) -> bytes:
        frame = np.zeros((540, 960, 3), dtype=np.uint8)
        frame[:] = (17, 24, 39)
        cv2.line(frame, (480, 0), (480, 540), (59, 130, 246), 2)
        cv2.putText(
            frame,
            "TANAW ML Camera Service",
            (270, 236),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.85,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            frame,
            message[:72],
            (90, 288),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (203, 213, 225),
            2,
            cv2.LINE_AA,
        )
        return self._encode_frame(frame)

    def _persist_count_event(
        self,
        session: ProcessingSession,
        track: ResolvedTrack,
        direction: str,
        visitor_decision: VisitorDecision | None = None,
    ) -> None:
        with self._lock:
            if not self._is_current_session_locked(session):
                return

            counts = self._counter.counts.as_dict()
            visitor_fields = visitor_decision.as_event_fields() if visitor_decision else {}
            camera_id = self._config.camera_id if self._config else None
            direction_count = counts.get(direction, 0)
            event_scope = session.event_scope or f"legacy-{session.session_id}"
            try:
                self._session_store.append_event(
                    {
                        "event_id": f"{camera_id}:{event_scope}:{direction}:{direction_count}",
                        "enterprise_id": self._enterprise_id,
                        "camera_id": camera_id,
                        "camera_name": self._config.camera_name if self._config else None,
                        "direction": direction,
                        "track_id": track.track_id,
                        "source_track_id": track.source_track_id,
                        "identity_state": track.identity_state,
                        "identity_score": track.identity_score,
                        "identity_source": track.identity_source,
                        **visitor_fields,
                        "counts": counts,
                    }
                )
            except OSError:
                pass
            self._persist_session_locked()

    def _persist_session_locked(self) -> None:
        counts = self._counter.counts.as_dict()
        payload = {
            "enterprise_id": self._enterprise_id,
            "running": self._state.running,
            "status": self._state.status,
            "error": redact_stream_credentials(self._state.error) if self._state.error else None,
            "camera_id": self._config.camera_id if self._config else None,
            "camera_name": self._config.camera_name if self._config else None,
            "camera_config": self._safe_config_dump() if self._config else None,
            "counts": {
                **counts,
                "running": self._state.running,
                "status": self._state.status,
                "error": redact_stream_credentials(self._state.error)
                if self._state.error
                else None,
            },
        }
        try:
            self._session_store.save_session(payload)
            saved_payload = self._session_store.load_session()
            self._session_updated_at = saved_payload.get("updated_at") if saved_payload else None
        except OSError:
            return

    def _public_config_dump(self) -> dict:
        if self._config is None:
            return {}

        payload = self._safe_config_dump()
        return payload

    def _safe_config_dump(self) -> dict:
        if self._config is None:
            return {}

        payload = self._config.model_dump(mode="json")
        password = payload.get("password")
        payload["password"] = None
        payload["password_redacted"] = bool(password)
        payload["stream_url"] = redact_stream_credentials(str(payload.get("stream_url", "")))
        if "***:***@" in payload["stream_url"]:
            payload["stream_url_credentials_redacted"] = True
        return payload

    def _restore_saved_snapshot(self, payload: dict | None) -> None:
        if not payload:
            return

        counts_payload = payload.get("counts")
        if not isinstance(counts_payload, dict):
            return

        with self._lock:
            self._session_updated_at = (
                payload.get("updated_at") if isinstance(payload.get("updated_at"), str) else None
            )
            self._counter.counts.entry = _safe_int(counts_payload.get("entry"))
            self._counter.counts.exit = _safe_int(counts_payload.get("exit"))
            self._counter.counts.occupancy = _safe_int(counts_payload.get("occupancy"))
            started_at = counts_payload.get("started_at")
            if isinstance(started_at, str):
                try:
                    self._counter.counts.started_at = datetime.fromisoformat(started_at)
                except ValueError:
                    self._counter.counts.started_at = None
            if isinstance(payload.get("status"), str):
                self._state.status = payload["status"]
            if isinstance(payload.get("error"), str) or payload.get("error") is None:
                self._state.error = payload.get("error")

    def _processing_fps(self, config: CameraStartRequest) -> float:
        if config.processing_fps is not None:
            return max(config.processing_fps, 1.0)
        if self._tracker.target_processing_fps is not None:
            return self._tracker.target_processing_fps
        return 8.0

    def _max_frame_width(self, config: CameraStartRequest) -> int:
        if config.max_frame_width is not None:
            return config.max_frame_width
        if self._effective_profile in {"balanced", "high_accuracy"}:
            return 960
        return 640

    def _configure_reid_locked(self, config: CameraStartRequest) -> None:
        self._effective_reid_mode = self._resolve_reid_mode(config.reid_mode)
        fast_profile = get_reid_model_profile("fast")
        quality_profile = get_reid_model_profile("quality")
        if (
            self._reidentifier.model_path == fast_profile.filename
            and self._quality_reidentifier.model_path == quality_profile.filename
        ):
            return

        self._reid_worker.close()
        self._quality_reid_worker.close()
        self._reidentifier = PersonReIdentifier.from_profile(fast_profile)
        self._quality_reidentifier = PersonReIdentifier.from_profile(quality_profile)
        self._reid_worker = AsyncReIdWorker(self._reidentifier)
        self._quality_reid_worker = AsyncReIdWorker(self._quality_reidentifier, max_queue_size=4)
        self._visitor_registry = UniqueVisitorRegistry(
            self._session_store,
            model_name=self._reidentifier.model_name,
            quality_model_name=self._quality_reidentifier.model_name,
        )

    def _resolve_reid_mode(self, requested_mode: str) -> str:
        if requested_mode in {"off", "fast", "quality"}:
            return requested_mode

        profile_config = getattr(self._tracker, "effective_profile", self._effective_profile)
        if profile_config == "high_accuracy":
            return "quality"
        if profile_config == "balanced":
            return "fast"
        return "off"

    def _fast_reid_enabled(self) -> bool:
        return self._effective_reid_mode in {"fast", "quality"}

    def _quality_reid_enabled(self) -> bool:
        return self._effective_reid_mode == "quality"

    def _reid_sampling_enabled(self, config: CameraStartRequest) -> bool:
        return self._fast_reid_enabled()

    def _counting_debug(
        self,
        track_id: int,
        *,
        inside_roi: bool,
        counting_confidence_passed: bool,
        tracking_confidence: float,
        counting_confidence: float,
    ) -> dict[str, Any]:
        debug = self._counter.debug_state(track_id) or {}
        reason = "eligible"
        if not counting_confidence_passed:
            reason = "below_counting_confidence"
        elif not inside_roi:
            reason = "outside_roi"

        return {
            **debug,
            "roi_passed": inside_roi,
            "counting_confidence_passed": counting_confidence_passed,
            "tracking_confidence": tracking_confidence,
            "counting_confidence": counting_confidence,
            "reason": debug.get("last_reason") or reason,
        }


def _safe_int(value: Any) -> int:
    return value if isinstance(value, int) else 0


def _age_ms(now: float, observed_at: float | None) -> float | None:
    if observed_at is None:
        return None
    return max(0.0, (now - observed_at) * 1000.0)


def _seconds_to_frames(seconds: float, processing_fps: float) -> int:
    return max(1, int(round(seconds * max(processing_fps, 1.0))))
