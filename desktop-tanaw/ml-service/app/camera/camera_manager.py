import logging
import os
import threading
import time
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

os.environ.setdefault("OPENCV_FFMPEG_LOGLEVEL", "16")
os.environ.setdefault("OPENCV_LOG_LEVEL", "ERROR")

import cv2
import numpy as np

from app.camera.auth import redact_stream_credentials
from app.camera.capture_runtime import CaptureRuntimeMixin
from app.camera.coverage_runtime import CoverageRuntimeMixin
from app.camera.identity_runtime import IdentityRuntimeMixin
from app.camera.persistence_runtime import PersistenceRuntimeMixin
from app.camera.processing_runtime import ProcessingRuntimeMixin
from app.camera.reconnect import (
    CameraConnectionState,
    CameraConnectionStateMachine,
    CameraFailureKind,
    CameraStreamFailure,
    ReconnectPolicy,
    classify_camera_failure,
)
from app.camera.rendering_runtime import RenderingRuntimeMixin
from app.camera.runtime_types import (
    DisplayTrack,
    PendingEntryEvent,
    ProcessingSession,
    RuntimeState,
)
from app.camera.simulation_runtime import SimulationRuntimeMixin
from app.config.camera_config import CameraStartRequest, CameraType
from app.counting.tripwire_counter import TripwireCounter
from app.detection.yolo_detector import YoloPersonTracker
from app.identity import UniqueVisitorRegistry
from app.reid import AsyncReIdWorker, PersonReIdentifier, TrackAppearanceBuffer
from app.reid.person_reid import get_reid_model_availability
from app.runtime.hardware import get_runtime_capabilities
from app.storage.runtime_store import EdgeRuntimeStore
from app.storage.session_credentials import persisted_camera_config_has_credentials
from app.tracking import TrackIdentityResolver

logger = logging.getLogger(__name__)


class CameraProcessingManager(
    SimulationRuntimeMixin,
    CaptureRuntimeMixin,
    CoverageRuntimeMixin,
    ProcessingRuntimeMixin,
    IdentityRuntimeMixin,
    RenderingRuntimeMixin,
    PersistenceRuntimeMixin,
):
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
        self._runtime_store = EdgeRuntimeStore(app_data_dir)
        self._visitor_registry = UniqueVisitorRegistry(
            self._runtime_store,
            model_name=self._reidentifier.model_name,
            quality_model_name=self._quality_reidentifier.model_name,
        )
        self._session_updated_at: str | None = None
        self._restoring_session = False
        self._effective_profile = "emergency"
        self._effective_reid_mode = "fast"
        self._processing_frame_age_ms: float | None = None
        self._processing_frames_skipped = 0
        self._simulation_thread: threading.Thread | None = None
        self._simulation_stop_event: threading.Event | None = None
        self._simulation_run_id: str | None = None
        self._simulation_events_generated = 0
        self._simulation_events_per_minute = 12
        self._simulation_mode: str | None = None
        self._simulation_scenario: str | None = None
        self._simulation_state = "idle"
        self._simulation_paused = False
        self._simulation_capacity = 100
        self._simulation_threshold_percent = 90
        self._simulation_duration_minutes: int | None = None
        self._simulation_started_at: str | None = None
        self._simulation_started_monotonic: float | None = None
        self._simulation_completed_at: str | None = None
        self._simulation_entry_probability: float | None = None
        self._simulation_unique_entry_rate = 0.88
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
            self._runtime_store = EdgeRuntimeStore(self._app_data_dir, normalized_id)
            self._visitor_registry = UniqueVisitorRegistry(
                self._runtime_store,
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
        self.stop_simulation()
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
            if self._simulation_mode == "virtual" and self._simulation_state in {
                "running",
                "paused",
            }:
                summary = self._runtime_store.metrics_summary(include_submitted=True)
                simulation_running = self._simulation_state == "running"
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
                        "started_at": self._simulation_started_at,
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
        return self._runtime_store.metrics_summary(include_submitted=include_submitted)

    def metrics_history(self, include_submitted: bool = False) -> dict:
        return self._runtime_store.metrics_history(include_submitted=include_submitted)

    def record_occupancy_correction(
        self,
        *,
        new_occupancy: int,
        reason: str,
        actor_id: str | None = None,
        actor_name: str | None = None,
        camera_id: int | None = None,
        classification: str | None = None,
    ) -> dict:
        with self._lock:
            summary = self._runtime_store.metrics_summary(include_submitted=True)
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
            resolved_classification = classification or self._current_classification_locked()
            simulation_run_id = (
                self._simulation_run_id if resolved_classification in {"simulation"} else None
            )

        correction = self._runtime_store.record_occupancy_correction(
            enterprise_id=self._enterprise_id,
            camera_id=resolved_camera_id,
            old_occupancy=old_occupancy,
            new_occupancy=max(0, new_occupancy),
            reason=reason,
            actor_id=actor_id,
            actor_name=actor_name,
            classification=resolved_classification,
            simulation_run_id=simulation_run_id,
        )

        with self._lock:
            self._counter.counts.occupancy = int(correction["new_occupancy"])
            self._persist_session_locked()
        return correction

    def occupancy_corrections(self, limit: int = 100) -> list[dict]:
        return self._runtime_store.list_occupancy_corrections(limit=limit)

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
        summary = self._runtime_store.metrics_summary(include_submitted=False)
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

    def create_local_report_revision(
        self,
        report_id: str,
        period_id: str,
        notes: str | None = None,
        payload: dict | None = None,
        metrics: dict | None = None,
        classification: str | None = None,
        simulation_run_id: str | None = None,
        *,
        idempotency_key: str | None = None,
        command_id: str | None = None,
    ) -> dict:
        submission = self._runtime_store.create_local_report_revision(
            report_id=report_id,
            period_id=period_id,
            notes=notes,
            payload=payload,
            metrics=metrics,
            classification=classification,
            simulation_run_id=simulation_run_id,
            idempotency_key=idempotency_key,
            command_id=command_id,
        )
        self._visitor_registry.cleanup_expired()
        return submission

    def list_local_reports(self, limit: int = 100) -> list[dict]:
        return self._runtime_store.list_local_reports(limit=limit)

    def list_ready_sync_outbox_items(
        self, limit: int = 100, now: str | None = None
    ) -> list[dict[str, Any]]:
        return self._runtime_store.list_ready_sync_outbox_items(limit=limit, now=now)

    def sync_outbox_health(self) -> dict[str, int | str | None]:
        return self._runtime_store.sync_outbox_health()

    def list_sync_outbox_recovery_items(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._runtime_store.list_sync_outbox_recovery_items(limit=limit)

    def get_sync_outbox_recovery_item(self, outbox_item_id: str) -> dict[str, Any] | None:
        return self._runtime_store.get_sync_outbox_recovery_item(outbox_item_id)

    def requeue_sync_outbox_item(
        self,
        outbox_item_id: str,
        *,
        reason: str,
        requeued_at: str | None = None,
    ) -> dict[str, Any]:
        return self._runtime_store.requeue_sync_outbox_item(
            outbox_item_id,
            reason=reason,
            requeued_at=requeued_at,
        )

    def operational_diagnostics(self) -> dict[str, Any]:
        return self._runtime_store.operational_diagnostics()

    def acknowledge_sync_outbox_item(
        self,
        outbox_item_id: str,
        acknowledgement: dict[str, Any] | None = None,
        acknowledged_at: str | None = None,
    ) -> bool:
        return self._runtime_store.acknowledge_sync_outbox_item(
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
        return self._runtime_store.record_sync_outbox_failure(
            outbox_item_id,
            error_class=error_class,
            error_message=error_message,
            retryable=retryable,
            http_status=http_status,
            failed_at=failed_at,
        )

    def purge_report_raw_events(self, report_id: str, consolidated_revision_id: str) -> dict:
        return self._runtime_store.purge_report_raw_events(report_id, consolidated_revision_id)

    def restore_last_session(self) -> bool:
        if self.running or self._restoring_session:
            return False

        payload = self._runtime_store.load_session()
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
            self._runtime_store,
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
