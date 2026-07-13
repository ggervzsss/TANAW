import logging
import os
import random
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

os.environ.setdefault("OPENCV_FFMPEG_LOGLEVEL", "16")
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")

import cv2
import numpy as np

from app.camera.auth import build_authenticated_stream_url, redact_stream_credentials
from app.camera.reconnect import (
    CameraConnectionState,
    CameraConnectionStateMachine,
    CameraFailureKind,
    CameraStreamFailure,
    ReconnectPolicy,
    classify_camera_failure,
)
from app.camera.stream_reader import (
    build_ip_webcam_snapshot_url,
    is_mjpeg_http_stream,
    iter_mjpeg_frames,
    open_capture,
    read_http_jpeg_frame,
    validate_http_jpeg_snapshot,
    validate_stream,
)
from app.config.camera_config import CameraStartRequest, CameraType, RegionOfInterest, TripwireLine
from app.counting.geometry import Centroid
from app.counting.tripwire_counter import TripwireCounter
from app.detection.yolo_detector import YoloPersonTracker
from app.identity import UniqueVisitorRegistry, VisitorDecision
from app.reid import AsyncReIdWorker, PersonReIdentifier, TrackAppearanceBuffer
from app.reid.person_reid import get_reid_model_availability
from app.runtime.hardware import get_runtime_capabilities
from app.storage.session_credentials import persisted_camera_config_has_credentials
from app.storage.session_store import SessionStore
from app.tracking import ResolvedTrack, TrackIdentityResolver

NormalizedPath = tuple[tuple[float, float], ...]

logger = logging.getLogger(__name__)


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
    monitoring_session_id: str | None = None


@dataclass(frozen=True)
class PendingEntryEvent:
    session_id: int
    track: ResolvedTrack
    direction: str
    created_at: float
    expires_at: float


class CameraProcessingManager:
    def __init__(
        self,
        app_data_dir: str | None = None,
        *,
        reconnect_policy: ReconnectPolicy | None = None,
        monotonic: Callable[[], float] = time.monotonic,
        utc_now: Callable[[], datetime] | None = None,
    ) -> None:
        self._app_data_dir = app_data_dir
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
        self._latest_jpeg: bytes | None = None
        self._latest_stream_jpeg: bytes | None = None
        self._latest_stream_frame_id = 0
        self._latest_tracks: list[DisplayTrack] = []
        self._state = RuntimeState()
        self._connection_state = CameraConnectionStateMachine()
        self._reconnect_policy = reconnect_policy or ReconnectPolicy()
        self._monotonic = monotonic
        self._utc_now = utc_now or (lambda: datetime.now(UTC))
        self._config: CameraStartRequest | None = None
        self._counter = TripwireCounter()
        self._tracker = YoloPersonTracker()
        self._reidentifier = PersonReIdentifier()
        self._reid_worker = AsyncReIdWorker(self._reidentifier)
        self._quality_reidentifier = PersonReIdentifier(
            model_path="person_reid.onnx",
            model_name="torchreid_osnet_ain_x1_0_msmt17_onnx",
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
        self._session_store = SessionStore(app_data_dir)
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
        self._mock_thread: threading.Thread | None = None
        self._mock_stop_event: threading.Event | None = None
        self._mock_run_id: str | None = None
        self._mock_events_generated = 0
        self._mock_events_per_minute = 12
        self._mock_mode: str | None = None
        self._mock_scenario: str | None = None
        self._mock_state = "idle"
        self._mock_paused = False
        self._mock_capacity = 100
        self._mock_threshold_percent = 90
        self._mock_duration_minutes: int | None = None
        self._mock_started_at: str | None = None
        self._mock_started_monotonic: float | None = None
        self._mock_completed_at: str | None = None
        self._mock_entry_probability: float | None = None
        self._mock_unique_entry_rate = 0.88
        self._enterprise_id: str | None = None
        self._enterprise_name: str | None = None

    @property
    def running(self) -> bool:
        with self._lock:
            return self._state.running

    def test_connection(
        self,
        stream_url: str,
        camera_type: CameraType = "IP_WEBCAM",
        username: str | None = None,
        password: str | None = None,
    ) -> tuple[bool, str]:
        try:
            config = CameraStartRequest(
                stream_url=stream_url,
                camera_type=camera_type,
                username=username,
                password=password,
            )
        except Exception as exc:
            return False, redact_stream_credentials(str(exc))

        return self._validate_config_stream(config)

    def bind_enterprise(self, enterprise_id: str, enterprise_name: str | None = None) -> dict:
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

        self.stop()
        with self._lock:
            self._enterprise_id = normalized_id
            self._enterprise_name = normalized_name
            self._session_store = SessionStore(self._app_data_dir, normalized_id)
            self._visitor_registry = UniqueVisitorRegistry(
                self._session_store,
                model_name=self._reidentifier.model_name,
                quality_model_name=self._quality_reidentifier.model_name,
            )
            self._state = RuntimeState()
            self._config = None
            self._session_updated_at = None
        restored = self.restore_last_session()
        return {
            "enterprise_id": normalized_id,
            "enterprise_name": normalized_name,
            "changed": True,
            "session_restored": restored,
        }

    def enterprise_context(self) -> dict:
        with self._lock:
            return {
                "enterprise_id": self._enterprise_id,
                "enterprise_name": self._enterprise_name,
            }

    def start(self, config: CameraStartRequest) -> None:
        ok, message = self._validate_config_stream(config)
        if not ok:
            failure = classify_camera_failure(
                CameraStreamFailure(message, reason="initial_connect")
            )
            if failure.kind is CameraFailureKind.NONRECOVERABLE:
                raise ValueError(failure.message)

        self.stop()

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
                lost_track_ttl_seconds=min(config.track_ttl_seconds, 3.0)
            )
            self._pending_entry_events.clear()
            self._visitor_registry.prepare(config.camera_id)
            self._visitor_registry.reset_session_tracks()
            self._processing_frame_age_ms = None
            self._processing_frames_skipped = 0
            self._latest_jpeg = self._build_status_frame("Initializing ML model...")
            self._latest_stream_jpeg = self._latest_jpeg
            self._latest_stream_frame_id += 1
            self._state = RuntimeState(running=False, status="starting", error=None)
            self._connection_state.reset()
            self._connection_state.transition(CameraConnectionState.CONNECTING)
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
                self._state = RuntimeState(running=False, status="error", error=safe_message)
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
                monitoring_session_id=str(uuid4()),
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
            self._latest_tracks = []
            try:
                self._start_monitoring_coverage(session)
            except Exception as exc:
                session.stop_event.set()
                self._end_monitoring_coverage(
                    session,
                    reason="coverage_ledger_unavailable",
                    error=True,
                )
                self._active_session = None
                self._connection_state.transition(CameraConnectionState.NONRECOVERABLE)
                safe_message = redact_stream_credentials(
                    f"Monitoring cannot start because local coverage evidence could not be "
                    f"created: {exc}"
                )
                self._state = RuntimeState(running=False, status="error", error=safe_message)
                raise RuntimeError(safe_message) from exc
            self._reader_thread = threading.Thread(
                target=self._capture_loop, args=(session,), name="tanaw-camera-reader", daemon=True
            )
            self._processing_thread = threading.Thread(
                target=self._processing_loop,
                args=(session,),
                name="tanaw-camera-processing",
                daemon=True,
            )
            self._stream_thread = threading.Thread(
                target=self._stream_encoding_loop,
                args=(session,),
                name="tanaw-camera-stream-encoder",
                daemon=True,
            )
            self._reader_thread.start()
            self._processing_thread.start()
            self._stream_thread.start()
            self._persist_session_locked()

    def stop(self) -> None:
        self.stop_mock_mode()
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
            if self._connection_state.state is not CameraConnectionState.STOPPED:
                self._connection_state.transition(CameraConnectionState.STOPPED)
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
            self._latest_tracks = []
            self._pending_entry_events.clear()
            self._latest_jpeg = self._build_status_frame("Camera processing stopped.")
            self._latest_stream_jpeg = self._latest_jpeg
            self._latest_stream_frame_id += 1
            self._state.running = False
            if self._state.status != "error":
                self._state.status = "stopped"
            self._persist_session_locked()

    def counts(self) -> dict[str, int | str | bool | None]:
        with self._lock:
            snapshot = self._counter.counts.as_dict()
            return {
                **snapshot,
                "running": self._state.running,
                "status": self._state.status,
                "error": redact_stream_credentials(self._state.error)
                if self._state.error
                else None,
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
            if self._mock_mode == "virtual" and self._mock_state in {"running", "paused"}:
                summary = self._session_store.metrics_summary(include_submitted=True)
                simulation_running = self._mock_state == "running"
                return {
                    "running": True,
                    "status": "simulating" if simulation_running else "simulation_paused",
                    "error": None,
                    "camera_id": None,
                    "camera_name": "Simulation Lab",
                    "camera_config": None,
                    "counts": {
                        "entry": summary["entries"],
                        "exit": summary["exits"],
                        "occupancy": summary["current_occupancy"],
                        "running": simulation_running,
                        "status": "simulating" if simulation_running else "simulation_paused",
                        "started_at": self._mock_started_at,
                        "error": None,
                    },
                    "updated_at": datetime.now(UTC).isoformat(),
                }

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
        source_kind: str | None = None,
    ) -> dict:
        with self._lock:
            summary = self._session_store.metrics_summary(include_submitted=True)
            old_occupancy = (
                self._counter.counts.occupancy
                if self._state.running
                else int(summary["current_occupancy"] or 0)
            )
            resolved_camera_id = (
                camera_id
                if camera_id is not None
                else self._config.camera_id
                if self._config
                else None
            )
            resolved_source_kind = source_kind or self._current_source_kind_locked()
            mock_run_id = self._mock_run_id if resolved_source_kind in {"mock", "hybrid"} else None

        correction = self._session_store.record_occupancy_correction(
            enterprise_id=self._enterprise_id,
            camera_id=resolved_camera_id,
            old_occupancy=old_occupancy,
            new_occupancy=max(0, new_occupancy),
            reason=reason,
            actor_id=actor_id,
            actor_name=actor_name,
            source_kind=resolved_source_kind,
            mock_run_id=mock_run_id,
        )

        with self._lock:
            self._counter.counts.occupancy = int(correction["new_occupancy"])
            self._persist_session_locked()
        return correction

    def occupancy_corrections(self, limit: int = 100) -> list[dict]:
        return self._session_store.list_occupancy_corrections(limit=limit)

    def model_status(self) -> dict:
        with self._lock:
            runtime_status = {
                "processing_frame_age_ms": self._processing_frame_age_ms,
                "processing_frames_skipped": self._processing_frames_skipped,
                "pending_unique_entries": len(self._pending_entry_events),
                "tracking_confidence": self._config.tracking_confidence if self._config else None,
                "counting_confidence": self._config.counting_confidence if self._config else None,
                "reid_mode": self._config.reid_mode if self._config else None,
                "effective_reid_mode": self._effective_reid_mode,
                "unique_counting_mode": self._config.unique_counting_mode if self._config else None,
            }
        summary = self._session_store.metrics_summary(include_submitted=False)
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
        period_id: str,
        notes: str | None = None,
        payload: dict | None = None,
        metrics: dict | None = None,
        source_kind: str | None = None,
        mock_run_id: str | None = None,
        *,
        idempotency_key: str | None = None,
        command_id: str | None = None,
    ) -> dict:
        submission = self._session_store.record_report_submission(
            report_id=report_id,
            period_id=period_id,
            notes=notes,
            payload=payload,
            metrics=metrics,
            source_kind=source_kind,
            mock_run_id=mock_run_id,
            idempotency_key=idempotency_key,
            command_id=command_id,
        )
        self._visitor_registry.cleanup_expired()
        return submission

    def list_report_submissions(self, limit: int = 100) -> list[dict]:
        return self._session_store.list_report_submissions(limit=limit)

    def list_ready_sync_outbox_items(
        self, limit: int = 100, now: str | None = None
    ) -> list[dict[str, Any]]:
        return self._session_store.list_ready_sync_outbox_items(limit=limit, now=now)

    def sync_outbox_health(self) -> dict[str, int | str | None]:
        return self._session_store.sync_outbox_health()

    def acknowledge_sync_outbox_item(
        self,
        outbox_item_id: str,
        acknowledgement: dict[str, Any] | None = None,
        acknowledged_at: str | None = None,
    ) -> bool:
        return self._session_store.acknowledge_sync_outbox_item(
            outbox_item_id,
            acknowledgement=acknowledgement,
            acknowledged_at=acknowledged_at,
        )

    def record_sync_outbox_failure(
        self,
        outbox_item_id: str,
        *,
        error_class: str,
        error_message: str,
        retryable: bool,
        http_status: int | None = None,
        failed_at: str | None = None,
    ) -> dict[str, Any]:
        return self._session_store.record_sync_outbox_failure(
            outbox_item_id,
            error_class=error_class,
            error_message=error_message,
            retryable=retryable,
            http_status=http_status,
            failed_at=failed_at,
        )

    def purge_report_raw_events(self, report_id: str) -> dict:
        return self._session_store.purge_report_raw_events(report_id)

    def prepare_mock_counts(
        self,
        *,
        mock_run_id: str,
        enterprise_id: str,
        enterprise_name: str | None,
        entries: int,
        exits: int,
        unique_count: int,
        peak_occupancy: int,
        period_id: str,
    ) -> dict:
        with self._lock:
            if self._enterprise_id != enterprise_id:
                raise ValueError(
                    f"Desktop is bound to {self._enterprise_id or 'no enterprise'}. "
                    f"Log into {enterprise_name or enterprise_id} before preparing counts."
                )
            camera_id = self._config.camera_id if self._config else None
            camera_name = self._config.camera_name if self._config else None

        summary = self._session_store.prepare_mock_counts(
            mock_run_id=mock_run_id,
            entries=entries,
            exits=exits,
            unique_count=unique_count,
            peak_occupancy=peak_occupancy,
            camera_id=camera_id,
            camera_name=camera_name,
            period_id=period_id,
        )
        return {
            **summary,
            "enterprise_id": enterprise_id,
            "enterprise_name": enterprise_name,
            "period": summary["period"],
            "prepared": bool(summary.get("prepared")),
        }

    def start_mock_mode(
        self,
        *,
        mock_run_id: str,
        mode: str = "virtual",
        scenario: str = "normal",
        events_per_minute: int = 12,
        capacity: int = 100,
        starting_occupancy: int | None = None,
        duration_minutes: int | None = None,
        threshold_percent: int = 90,
        entry_probability: float | None = None,
        unique_entry_rate: float = 0.88,
    ) -> dict:
        with self._lock:
            if not self._enterprise_id:
                raise ValueError("Log into an enterprise account before starting a simulation.")
            if mode == "hybrid" and (not self._state.running or self._config is None):
                raise ValueError("Hybrid mock mode requires an active real camera session.")

        self.stop_mock_mode()
        if starting_occupancy is not None:
            self._set_mock_starting_occupancy(mock_run_id, mode, starting_occupancy)

        stop_event = threading.Event()
        with self._lock:
            self._mock_stop_event = stop_event
            self._mock_run_id = mock_run_id
            self._mock_mode = mode
            self._mock_scenario = scenario
            self._mock_state = "running"
            self._mock_paused = False
            self._mock_events_per_minute = max(1, min(events_per_minute, 120))
            self._mock_capacity = max(1, capacity)
            self._mock_threshold_percent = max(1, min(threshold_percent, 100))
            self._mock_duration_minutes = duration_minutes
            self._mock_started_at = datetime.now(UTC).isoformat()
            self._mock_started_monotonic = time.monotonic()
            self._mock_completed_at = None
            self._mock_entry_probability = entry_probability
            self._mock_unique_entry_rate = max(0.0, min(unique_entry_rate, 1.0))
            self._mock_events_generated = 0
            self._mock_thread = threading.Thread(
                target=self._mock_event_loop,
                args=(stop_event, mock_run_id),
                name="tanaw-live-simulation",
                daemon=True,
            )
            self._mock_thread.start()
        return self.mock_status()

    def pause_mock_mode(self) -> dict:
        with self._lock:
            if self._mock_state != "running":
                raise ValueError("No running simulation is available to pause.")
            self._mock_paused = True
            self._mock_state = "paused"
        return self.mock_status()

    def resume_mock_mode(self) -> dict:
        with self._lock:
            if self._mock_state != "paused" or self._mock_thread is None:
                raise ValueError("No paused simulation is available to resume.")
            self._mock_paused = False
            self._mock_state = "running"
        return self.mock_status()

    def stop_mock_mode(self) -> dict:
        with self._lock:
            thread = self._mock_thread
            stop_event = self._mock_stop_event
            if stop_event is not None:
                stop_event.set()

        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=2)

        with self._lock:
            self._mock_thread = None
            self._mock_stop_event = None
            self._mock_paused = False
            if self._mock_state in {"running", "paused"}:
                self._mock_state = "stopped"
                self._mock_completed_at = datetime.now(UTC).isoformat()
        return self.mock_status()

    def reset_mock_data(self, mock_run_id: str | None = None) -> dict:
        with self._lock:
            should_stop_current_run = mock_run_id is None or self._mock_run_id == mock_run_id
        if should_stop_current_run:
            self.stop_mock_mode()
        removed = self._session_store.remove_mock_data(mock_run_id)
        with self._lock:
            if mock_run_id is None or self._mock_run_id == mock_run_id:
                self._mock_run_id = None
                self._mock_mode = None
                self._mock_scenario = None
                self._mock_state = "idle"
                self._mock_events_generated = 0
                self._mock_started_at = None
                self._mock_started_monotonic = None
                self._mock_completed_at = None
        return removed

    def append_mock_event(self, direction: str) -> dict:
        with self._lock:
            if self._mock_state not in {"running", "paused"} or not self._mock_run_id:
                raise ValueError("Start a simulation before adding manual events.")
            mock_run_id = self._mock_run_id
            mode = self._mock_mode or "virtual"

        if not self._append_mock_count_event(direction, mock_run_id, mode):
            if direction == "exit":
                raise ValueError("An exit cannot be recorded while occupancy is zero.")
            raise ValueError("The simulated event could not be recorded.")
        return self.mock_status()

    def mock_status(self) -> dict:
        summary = self._session_store.metrics_summary(include_submitted=True)
        with self._lock:
            running = self._mock_thread is not None and self._mock_thread.is_alive()
            prepared_run_id = (
                summary["mock_run_id"] if summary["source_kind"] in {"mock", "hybrid"} else None
            )
            return {
                "running": running and self._mock_state == "running",
                "paused": running and self._mock_state == "paused",
                "state": self._mock_state,
                "mode": self._mock_mode or ("prepared" if prepared_run_id else None),
                "scenario": self._mock_scenario,
                "mock_run_id": self._mock_run_id or prepared_run_id,
                "events_generated": self._mock_events_generated
                if self._mock_run_id
                else summary["total_events"],
                "events_per_minute": self._mock_events_per_minute,
                "requires_real_camera": self._mock_mode == "hybrid",
                "enterprise_id": self._enterprise_id,
                "enterprise_name": self._enterprise_name,
                "capacity": self._mock_capacity,
                "threshold_percent": self._mock_threshold_percent,
                "duration_minutes": self._mock_duration_minutes,
                "started_at": self._mock_started_at,
                "completed_at": self._mock_completed_at,
                "entries": summary["entries"],
                "exits": summary["exits"],
                "current_occupancy": summary["current_occupancy"],
                "peak_occupancy": summary["peak_occupancy"],
                "unique_count": summary["unique_count"],
                "unsubmitted_events": summary["unsubmitted_events"],
            }

    def _current_source_kind_locked(self) -> str:
        if self._mock_state in {"running", "paused"}:
            return "hybrid" if self._mock_mode == "hybrid" else "mock"
        return "real"

    def generate_mock_report(
        self,
        report_id: str | None,
        period_id: str,
        notes: str | None = None,
        payload: dict | None = None,
    ) -> dict:
        with self._lock:
            mock_run_id = self._mock_run_id
        if not mock_run_id:
            raise ValueError("Hybrid mock mode is not running.")

        resolved_report_id = report_id or f"REP-{int(time.time()) % 1_000_000:06d}"
        report_payload = {
            "status": "Submitted",
            "sourceKind": "hybrid",
            "mockRunId": mock_run_id,
            **(payload or {}),
        }
        return self.record_report_submission(
            resolved_report_id,
            period_id,
            notes or "Monthly camera analytics submitted for LGU review.",
            report_payload,
            source_kind="hybrid",
            mock_run_id=mock_run_id,
        )

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
        if persisted_camera_config_has_credentials(camera_config):
            self._restore_saved_snapshot(payload)
            return False
        if (
            camera_config.get("password_redacted")
            or camera_config.get("stream_url_credentials_redacted")
            or camera_config.get("username_redacted")
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
                        status="error",
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

    def _mock_event_loop(self, stop_event: threading.Event, mock_run_id: str) -> None:
        rng = random.Random(mock_run_id)
        while not stop_event.is_set():
            with self._lock:
                mode = self._mock_mode or "virtual"
                if mode == "hybrid" and (not self._state.running or self._config is None):
                    break
                paused = self._mock_paused
                events_per_minute = self._mock_events_per_minute
                duration_minutes = self._mock_duration_minutes
                started_monotonic = self._mock_started_monotonic

            if paused:
                stop_event.wait(0.25)
                continue

            jitter = rng.uniform(0.82, 1.18)
            if stop_event.wait(max(0.5, (60.0 / events_per_minute) * jitter)):
                break

            with self._lock:
                if self._mock_paused:
                    continue

            if (
                duration_minutes is not None
                and started_monotonic is not None
                and time.monotonic() - started_monotonic >= duration_minutes * 60
            ):
                with self._lock:
                    self._mock_state = "completed"
                    self._mock_completed_at = datetime.now(UTC).isoformat()
                break

            summary = self._session_store.metrics_summary(include_submitted=True)
            occupancy = int(summary["current_occupancy"] or 0)
            direction = self._next_mock_direction(rng, occupancy)
            if direction is None:
                with self._lock:
                    self._mock_state = "completed"
                    self._mock_completed_at = datetime.now(UTC).isoformat()
                break

            self._append_mock_count_event(direction, mock_run_id, mode, rng)

        with self._lock:
            if self._mock_thread is threading.current_thread():
                self._mock_thread = None
                self._mock_stop_event = None

    def _next_mock_direction(self, rng: random.Random, occupancy: int) -> str | None:
        with self._lock:
            scenario = self._mock_scenario or "normal"
            capacity = max(1, self._mock_capacity)
            custom_probability = self._mock_entry_probability

        if scenario == "evacuation" and occupancy <= 0:
            return None
        if occupancy <= 0:
            return "entry"

        occupancy_ratio = occupancy / capacity
        if scenario == "morning-rush":
            entry_probability = 0.76 if occupancy_ratio < 0.85 else 0.42
        elif scenario == "event-opening":
            entry_probability = 0.84 if occupancy_ratio < 0.8 else 0.55
        elif scenario == "overcrowding":
            entry_probability = 0.92 if occupancy_ratio < 1.1 else 0.32
        elif scenario == "evacuation":
            entry_probability = 0.06
        elif scenario == "custom":
            entry_probability = custom_probability if custom_probability is not None else 0.5
        else:
            entry_probability = 0.57 if occupancy_ratio < 0.55 else 0.43

        return "entry" if rng.random() < entry_probability else "exit"

    def _append_mock_count_event(
        self,
        direction: str,
        mock_run_id: str,
        mode: str,
        rng: random.Random | None = None,
    ) -> bool:
        rng = rng or random.Random(f"{mock_run_id}:{time.time_ns()}")
        summary = self._session_store.metrics_summary(include_submitted=True)
        entries = int(summary["entries"] or 0)
        exits = int(summary["exits"] or 0)
        occupancy = int(summary["current_occupancy"] or 0)
        if direction == "exit" and occupancy <= 0:
            return False

        next_entries = entries + (1 if direction == "entry" else 0)
        next_exits = exits + (1 if direction == "exit" else 0)
        next_occupancy = max(0, occupancy + (1 if direction == "entry" else -1))
        with self._lock:
            event_index = self._mock_events_generated + 1
            camera_id = self._config.camera_id if mode == "hybrid" and self._config else None
            camera_name = (
                self._config.camera_name if mode == "hybrid" and self._config else "Simulation Lab"
            )
            unique_entry_rate = self._mock_unique_entry_rate

        is_unique_entry = direction == "entry" and rng.random() < unique_entry_rate
        visitor_id = str(uuid4()) if is_unique_entry and rng.random() < 0.88 else None
        payload = {
            "camera_id": camera_id,
            "camera_name": camera_name,
            "direction": direction,
            "track_id": 100_000 + event_index,
            "source_track_id": 100_000 + event_index,
            "visitor_id": visitor_id,
            "is_unique_entry": is_unique_entry,
            "reid_score": round(rng.uniform(0.72, 0.96), 3) if visitor_id else None,
            "reid_decision": "new"
            if visitor_id
            else ("degraded_no_embedding" if is_unique_entry else None),
            "identity_confidence": "high"
            if visitor_id
            else ("degraded" if is_unique_entry else None),
            "identity_state": "confirmed" if visitor_id else "unconfirmed",
            "identity_score": round(rng.uniform(0.7, 0.98), 3),
            "identity_source": "appearance" if visitor_id else "virtual-sensor",
            "source_kind": "hybrid" if mode == "hybrid" else "mock",
            "mock_run_id": mock_run_id,
            "counts": {
                "entry": next_entries,
                "exit": next_exits,
                "occupancy": next_occupancy,
            },
        }
        try:
            self._session_store.append_event(payload)
        except Exception as exc:
            self._record_persistence_failure("append_mock_event", exc)
            return False

        with self._lock:
            self._mock_events_generated += 1
        return True

    def _set_mock_starting_occupancy(
        self, mock_run_id: str, mode: str, starting_occupancy: int
    ) -> None:
        summary = self._session_store.metrics_summary(include_submitted=True)
        current_occupancy = int(summary["current_occupancy"] or 0)
        direction = "entry" if starting_occupancy > current_occupancy else "exit"
        difference = abs(starting_occupancy - current_occupancy)
        rng = random.Random(f"{mock_run_id}:starting-occupancy")
        for _ in range(difference):
            if not self._append_mock_count_event(direction, mock_run_id, mode, rng):
                break

    def latest_frame(self) -> bytes:
        with self._lock:
            if self._latest_stream_jpeg is not None:
                return self._latest_stream_jpeg
            if self._latest_jpeg is not None:
                return self._latest_jpeg
            else:
                return self._build_status_frame("No camera stream available.")

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
        if not self._is_current_session(session):
            return

        reconnect_attempt = 0
        terminal_error = False
        close_reason = "operator_stopped"
        try:
            while not session.stop_event.is_set() and self._is_current_session(session):
                try:
                    self._capture_once(session)
                    break
                except Exception as exc:
                    if session.stop_event.is_set() or not self._is_current_session(session):
                        break
                    failure = classify_camera_failure(exc)
                    safe_message = redact_stream_credentials(failure.message)
                    if failure.kind is CameraFailureKind.NONRECOVERABLE:
                        terminal_error = True
                        close_reason = failure.reason
                        self._record_coverage_gap(
                            session,
                            reason=failure.reason,
                            recoverable=False,
                            detail=safe_message,
                        )
                        with self._lock:
                            if self._is_current_session_locked(session):
                                self._connection_state.transition(
                                    CameraConnectionState.NONRECOVERABLE
                                )
                        self._set_session_error(
                            session,
                            f"Camera configuration requires attention: {safe_message}",
                        )
                        break

                    if self._connection_state.state is CameraConnectionState.RUNNING:
                        reconnect_attempt = 0
                    reconnect_attempt += 1
                    delay = self._reconnect_policy.delay_for_attempt(reconnect_attempt)
                    self._record_coverage_gap(
                        session,
                        reason=failure.reason,
                        recoverable=True,
                        detail=safe_message,
                    )
                    self._set_session_reconnecting(session, safe_message, delay)
                    if session.stop_event.wait(delay):
                        break
                    with self._lock:
                        if not self._is_current_session_locked(session):
                            break
                        self._connection_state.transition(CameraConnectionState.CONNECTING)
                        self._state.status = "connecting"
                        self._state.error = None
        finally:
            with self._lock:
                stopped_with_error = (
                    terminal_error
                    or self._connection_state.state is CameraConnectionState.NONRECOVERABLE
                )
            self._end_monitoring_coverage(
                session,
                reason=(
                    close_reason
                    if terminal_error or not stopped_with_error
                    else "processing_failure"
                ),
                error=stopped_with_error,
            )

    def _capture_once(self, session: ProcessingSession) -> None:
        config = session.config
        runtime_stream_url = self._runtime_stream_url(config)
        snapshot_url = (
            build_ip_webcam_snapshot_url(runtime_stream_url)
            if config.camera_type == "IP_WEBCAM"
            else None
        )
        if snapshot_url is not None:
            self._ip_webcam_snapshot_capture_once(session, snapshot_url)
            return
        if is_mjpeg_http_stream(runtime_stream_url):
            self._mjpeg_capture_once(session, runtime_stream_url)
            return
        self._opencv_capture_once(session, runtime_stream_url)

    def _validate_config_stream(self, config: CameraStartRequest) -> tuple[bool, str]:
        runtime_stream_url = self._runtime_stream_url(config)
        snapshot_url = (
            build_ip_webcam_snapshot_url(runtime_stream_url)
            if config.camera_type == "IP_WEBCAM"
            else None
        )
        if snapshot_url is not None:
            ok, message = validate_http_jpeg_snapshot(snapshot_url)
            return ok, redact_stream_credentials(message)

        ok, message = validate_stream(runtime_stream_url)
        return ok, redact_stream_credentials(message)

    def _runtime_stream_url(self, config: CameraStartRequest) -> str:
        return build_authenticated_stream_url(config.stream_url, config.username, config.password)

    def _ip_webcam_snapshot_capture_once(
        self, session: ProcessingSession, snapshot_url: str
    ) -> None:
        config = session.config
        failed_reads = 0
        last_error = "Camera snapshot endpoint stopped returning frames."
        frame_interval = 1.0 / self._processing_fps(config)

        while not session.stop_event.is_set() and self._is_current_session(session):
            started_at = self._monotonic()
            try:
                frame = read_http_jpeg_frame(snapshot_url)
            except Exception as exc:
                frame = None
                last_error = str(exc)
            if frame is None:
                failed_reads += 1
                if failed_reads >= 30:
                    raise CameraStreamFailure(
                        f"Camera snapshot endpoint stopped returning frames: {last_error}",
                        reason="snapshot_unavailable",
                    )
            else:
                failed_reads = 0
                frame = self._resize_for_processing(frame, self._max_frame_width(config))
                self._publish_raw_frame(session, frame)
            elapsed = self._monotonic() - started_at
            remaining = frame_interval - elapsed
            if remaining > 0:
                session.stop_event.wait(remaining)

    def _mjpeg_capture_once(self, session: ProcessingSession, stream_url: str) -> None:
        config = session.config
        for frame in iter_mjpeg_frames(stream_url, session.stop_event):
            if session.stop_event.is_set() or not self._is_current_session(session):
                return
            frame = self._resize_for_processing(frame, self._max_frame_width(config))
            self._publish_raw_frame(session, frame)
        if not session.stop_event.is_set() and self._is_current_session(session):
            raise CameraStreamFailure(
                "Camera stream stopped returning MJPEG frames.",
                reason="mjpeg_stream_ended",
            )

    def _opencv_capture_once(self, session: ProcessingSession, stream_url: str) -> None:
        config = session.config
        capture = open_capture(stream_url)
        failed_reads = 0

        try:
            if not capture.isOpened():
                raise CameraStreamFailure(
                    "Camera stream could not be opened.", reason="stream_open_failed"
                )

            while not session.stop_event.is_set() and self._is_current_session(session):
                ok, frame = capture.read()
                if not ok or frame is None:
                    failed_reads += 1
                    if failed_reads >= 90:
                        raise CameraStreamFailure(
                            "Camera stream stopped returning frames.",
                            reason="frame_read_timeout",
                        )
                    session.stop_event.wait(0.05)
                    continue

                failed_reads = 0
                frame = self._resize_for_processing(frame, self._max_frame_width(config))
                self._publish_raw_frame(session, frame)
        finally:
            capture.release()

    def _publish_raw_frame(
        self, session: ProcessingSession, frame: np.ndarray, captured_at: float | None = None
    ) -> None:
        with self._lock:
            should_mark_connected = (
                self._is_current_session_locked(session)
                and self._connection_state.state is not CameraConnectionState.RUNNING
            )
        if should_mark_connected and session.monitoring_session_id is not None:
            self._session_store.mark_monitoring_connected(
                session.monitoring_session_id,
                self._utc_now().isoformat(),
            )
        with self._raw_frame_condition:
            if not self._is_current_session_locked(session):
                return
            if self._connection_state.state is not CameraConnectionState.RUNNING:
                if self._connection_state.state is CameraConnectionState.STOPPED:
                    self._connection_state.transition(CameraConnectionState.CONNECTING)
                self._connection_state.transition(CameraConnectionState.RUNNING)
            self._latest_raw_frame = frame
            self._latest_raw_frame_id += 1
            self._latest_raw_frame_captured_at = (
                captured_at if captured_at is not None else self._monotonic()
            )
            self._state.status = "running"
            self._state.error = None
            self._raw_frame_condition.notify_all()

    def _start_monitoring_coverage(self, session: ProcessingSession) -> None:
        if session.monitoring_session_id is None:
            return
        started_at = self._utc_now().isoformat()
        config = session.config
        self._session_store.start_monitoring_session(
            monitoring_session_id=session.monitoring_session_id,
            camera_id=config.camera_id,
            camera_name=config.camera_name,
            central_camera_id=getattr(config, "central_camera_id", None),
            started_at=started_at,
        )
        self._session_store.record_coverage_gap(
            monitoring_session_id=session.monitoring_session_id,
            camera_id=config.camera_id,
            camera_name=config.camera_name,
            central_camera_id=getattr(config, "central_camera_id", None),
            started_at=started_at,
            reason="initial_connection",
            recoverable=True,
            detail="Waiting for the first valid camera frame.",
        )

    def _record_coverage_gap(
        self,
        session: ProcessingSession,
        *,
        reason: str,
        recoverable: bool,
        detail: str,
    ) -> None:
        if session.monitoring_session_id is None:
            return
        config = session.config
        try:
            self._session_store.record_coverage_gap(
                monitoring_session_id=session.monitoring_session_id,
                camera_id=config.camera_id,
                camera_name=config.camera_name,
                central_camera_id=getattr(config, "central_camera_id", None),
                started_at=self._utc_now().isoformat(),
                reason=reason,
                recoverable=recoverable,
                detail=detail,
            )
        except Exception as exc:
            logger.error("Unable to persist camera coverage gap: %s", exc)

    def _end_monitoring_coverage(
        self, session: ProcessingSession, *, reason: str, error: bool
    ) -> None:
        if session.monitoring_session_id is None:
            return
        try:
            self._session_store.end_monitoring_session(
                session.monitoring_session_id,
                ended_at=self._utc_now().isoformat(),
                reason=reason,
                error=error,
            )
        except Exception as exc:
            logger.error("Unable to close camera monitoring session: %s", exc)

    def _set_session_reconnecting(
        self, session: ProcessingSession, message: str, delay_seconds: float
    ) -> None:
        with self._raw_frame_condition:
            if not self._is_current_session_locked(session):
                return
            self._connection_state.transition(CameraConnectionState.BACKOFF)
            safe_message = redact_stream_credentials(message)
            status_message = (
                f"Camera stream interrupted; reconnecting in {delay_seconds:.1f}s. {safe_message}"
            )
            self._state = RuntimeState(
                running=True,
                status="reconnecting",
                error=status_message,
            )
            self._latest_jpeg = self._build_status_frame(status_message)
            self._latest_stream_jpeg = self._latest_jpeg
            self._latest_stream_frame_id += 1
            self._persist_session_locked()
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
            if self._connection_state.state is not CameraConnectionState.NONRECOVERABLE:
                if self._connection_state.state is CameraConnectionState.STOPPED:
                    self._connection_state.transition(CameraConnectionState.CONNECTING)
                self._connection_state.transition(CameraConnectionState.NONRECOVERABLE)
            self._state = RuntimeState(running=False, status="error", error=safe_message)
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
            try:
                self._session_store.append_event(
                    {
                        "camera_id": self._config.camera_id if self._config else None,
                        "camera_name": self._config.camera_name if self._config else None,
                        "direction": direction,
                        "track_id": track.track_id,
                        "source_track_id": track.source_track_id,
                        "identity_state": track.identity_state,
                        "identity_score": track.identity_score,
                        "identity_source": track.identity_source,
                        "source_kind": "real",
                        "mock_run_id": None,
                        **visitor_fields,
                        "counts": counts,
                    }
                )
            except Exception as exc:
                self._record_persistence_failure("append_count_event", exc, session=session)
                raise RuntimeError(
                    "A camera count could not be durably recorded; monitoring was stopped "
                    "to prevent an inaccurate report."
                ) from exc
            self._persist_session_locked()

    def _persist_session_locked(self) -> None:
        counts = self._counter.counts.as_dict()
        payload = {
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
        except Exception as exc:
            self._record_persistence_failure("save_session_snapshot", exc)
            return

    def _record_persistence_failure(
        self,
        operation: str,
        error: BaseException,
        *,
        session: ProcessingSession | None = None,
    ) -> None:
        attempt_count = getattr(error, "attempts", 1)
        safe_detail = redact_stream_credentials(str(error))
        try:
            self._session_store.record_persistence_error(
                operation=operation,
                reason="sqlite_write_failed",
                detail=safe_detail,
                attempt_count=attempt_count,
                occurred_at=self._utc_now().isoformat(),
            )
        except Exception as diagnostic_error:
            logger.error(
                "Local persistence failed and its diagnostic could not be recorded: %s",
                diagnostic_error,
            )
        active_session = session or self._active_session
        if active_session is not None:
            self._record_coverage_gap(
                active_session,
                reason="persistence_failure",
                recoverable=False,
                detail=safe_detail,
            )

    def _public_config_dump(self) -> dict:
        if self._config is None:
            return {}

        payload = self._safe_config_dump()
        return payload

    def _safe_config_dump(self) -> dict:
        if self._config is None:
            return {}

        payload = self._config.model_dump(mode="json")
        username = payload.get("username")
        password = payload.get("password")
        payload["username"] = None
        payload["username_redacted"] = bool(username)
        payload["password"] = None
        payload["password_redacted"] = bool(password)
        payload["stream_url"] = redact_stream_credentials(str(payload.get("stream_url", "")))
        payload["stream_url_credentials_redacted"] = "***:***@" in payload["stream_url"]
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
        fast_model_path = "person_reid_cpu.onnx"
        fast_model_name = "torchreid_osnet_x0_25_msmt17_onnx"
        quality_model_path = "person_reid.onnx"
        quality_model_name = "torchreid_osnet_ain_x1_0_msmt17_onnx"
        if (
            self._reidentifier.model_path == fast_model_path
            and self._quality_reidentifier.model_path == quality_model_path
        ):
            return

        self._reid_worker.close()
        self._quality_reid_worker.close()
        self._reidentifier = PersonReIdentifier(
            model_path=fast_model_path,
            model_name=fast_model_name,
        )
        self._quality_reidentifier = PersonReIdentifier(
            model_path=quality_model_path,
            model_name=quality_model_name,
        )
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
        if profile_config in {"balanced", "high_accuracy"}:
            return "fast"
        return "off"

    def _fast_reid_enabled(self) -> bool:
        return self._effective_reid_mode in {"fast", "quality"}

    def _quality_reid_enabled(self) -> bool:
        return self._effective_reid_mode == "quality"

    def _reid_sampling_enabled(self, config: CameraStartRequest) -> bool:
        return config.unique_counting_mode == "estimated_reid" and self._fast_reid_enabled()

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


def _seconds_to_frames(seconds: float, processing_fps: float) -> int:
    return max(1, int(round(seconds * max(processing_fps, 1.0))))
