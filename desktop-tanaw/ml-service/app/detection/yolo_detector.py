from __future__ import annotations

from collections import deque
from dataclasses import dataclass, replace
from pathlib import Path
from threading import Lock
from time import monotonic
from typing import Any

import numpy as np

from app.counting.geometry import Centroid, bbox_centroid
from app.detection.detector_selection import (
    DETECTOR_PROFILES,
    PROFILE_FALLBACKS,
    DetectorSelection,
    detector_model_availability,
    resolve_model_path,
    select_detector,
)
from app.runtime.assets import model_directory
from app.runtime.config_directories import configure_third_party_directories
from app.runtime.hardware import get_runtime_capabilities

configure_third_party_directories()

PERSON_CLASS_IDS = (0,)
_GLOBAL_INFERENCE_LOCK = Lock()


@dataclass(frozen=True)
class TrackResult:
    track_id: int
    bbox: tuple[int, int, int, int]
    confidence: float
    centroid: Centroid
    counting_point: Centroid


class YoloPersonTracker:
    def __init__(
        self, model_path: str = "yolo11n.pt", image_size: int = 480, max_detections: int = 32
    ) -> None:
        self.model_path = model_path
        self.image_size = image_size
        self.nms_iou = 0.45
        self.max_detections = max_detections
        self.processing_profile = "auto"
        self.requested_profile = "auto"
        self.normalized_profile = "auto"
        self.effective_profile = "emergency"
        self.model_name = "yolo11n"
        self.selected_runtime = "cpu"
        self.requested_runtime = "auto"
        self.requested_tracker = "auto"
        self.effective_tracker = "bytetrack"
        self.tracker_config_path = str(_tracker_config_path("emergency", "bytetrack"))
        self.selection_reason = "Using emergency defaults until the detector is configured."
        self.fallback_reason: str | None = None
        self.fallback_chain: tuple[str, ...] = ("emergency",)
        self.target_processing_fps: float | None = 7.0
        self._model: Any | None = None
        self._device = "cpu"
        self._use_half = False
        self._warmed_up = False
        self._loading = False
        self._resolved_model_path: str | None = None
        self._lock = Lock()
        self._warmup_lock = Lock()
        self._telemetry_lock = Lock()
        self._inference_times_ms: deque[float] = deque(maxlen=128)
        self._last_inference_at: float | None = None
        self._inference_intervals: deque[float] = deque(maxlen=128)
        self.configure("auto")

    def status(self) -> dict[str, Any]:
        telemetry = self._telemetry()
        availability = get_detector_model_availability()
        if not self._lock.acquire(blocking=False):
            return {
                "model_loaded": self._model is not None,
                "model_ready": self._warmed_up,
                "device": self._device,
                "model_path": self._resolved_model_path,
                "model_loading": True,
                **self._profile_status_fields(availability),
                **telemetry,
            }

        try:
            return {
                "model_loaded": self._model is not None,
                "model_ready": self._warmed_up,
                "device": self._device,
                "model_path": self._resolved_model_path,
                "model_loading": self._loading,
                **self._profile_status_fields(availability),
                **telemetry,
            }
        finally:
            self._lock.release()

    def configure(
        self,
        processing_profile: str,
        runtime_backend: str = "auto",
        tracker_profile: str = "auto",
    ) -> str:
        selection = resolve_detector_selection(
            processing_profile=processing_profile,
            runtime_backend=runtime_backend,
            tracker_profile=tracker_profile,
        )
        with self._lock:
            changed = self._selection_changed(selection)
            self._apply_selection_locked(selection)
            if changed and self._model is not None:
                self._clear_loaded_model_locked()
        return self.effective_profile

    def reset_tracking(self) -> None:
        model = self._model
        predictor = getattr(model, "predictor", None) if model is not None else None
        for tracker in getattr(predictor, "trackers", []) or []:
            reset = getattr(tracker, "reset", None)
            if callable(reset):
                reset()
        self._last_inference_at = None
        with self._telemetry_lock:
            self._inference_times_ms.clear()
            self._inference_intervals.clear()

    def _resolve_model_path(self) -> str:
        with self._lock:
            profile = self.effective_profile
            runtime = self.selected_runtime

        model_path = _resolve_model_path_for(self.model_path, profile, runtime)
        if model_path is not None:
            return str(model_path)

        profile_config = DETECTOR_PROFILES[profile]
        bundled_path = _models_root() / f"{profile_config.model_name}.pt"
        raise FileNotFoundError(
            f"YOLO model file was not found for {profile_config.model_name} at {bundled_path}. "
            "Ensure the bundled model exists under ml-service/models."
        )

    def _load_model(self) -> Any:
        with self._lock:
            if self._model is not None:
                return self._model

            import torch
            from ultralytics import YOLO

            model_path = _resolve_model_path_for(
                self.model_path, self.effective_profile, self.selected_runtime
            )
            if model_path is None:
                profile_config = DETECTOR_PROFILES[self.effective_profile]
                raise FileNotFoundError(
                    f"YOLO model file was not found for {profile_config.model_name}. "
                    "Ensure the bundled model exists under ml-service/models."
                )
            model_source = str(model_path)
            try:
                self._loading = True
                self._model = YOLO(model_source, task="detect")
                self._resolved_model_path = model_source
                self._device = (
                    "cuda:0"
                    if self.selected_runtime == "cuda" and torch.cuda.is_available()
                    else "cpu"
                )
                self._use_half = self._device.startswith("cuda")
                try:
                    self._model.fuse()
                except Exception:
                    pass
            finally:
                self._loading = False
            return self._model

    def warmup(self) -> None:
        last_error: Exception | None = None
        for _ in range(len(DETECTOR_PROFILES)):
            try:
                with self._warmup_lock:
                    with self._lock:
                        if self._warmed_up:
                            return

                    model = self._load_model()
                    self._benchmark_predict(model)
                    with self._lock:
                        self._warmed_up = True
                return
            except Exception as exc:
                last_error = exc
                if not self._fallback_after_runtime_failure(exc):
                    raise

        if last_error is not None:
            raise last_error

    def track_people(self, frame: np.ndarray, confidence: float) -> list[TrackResult]:
        model = self._load_model()
        try:
            results = self._track_with_config(model, frame, confidence)
        except Exception as exc:
            if not self._fallback_tracker_after_failure(exc):
                raise
            results = self._track_with_config(model, frame, confidence)

        if not results:
            return []

        boxes = results[0].boxes
        if boxes is None:
            return []

        xyxy = boxes.xyxy.cpu().tolist()
        confidences = boxes.conf.cpu().tolist()
        class_ids = (
            boxes.cls.int().cpu().tolist()
            if getattr(boxes, "cls", None) is not None
            else [PERSON_CLASS_IDS[0] for _ in range(len(xyxy))]
        )
        track_ids = (
            boxes.id.int().cpu().tolist()
            if boxes.id is not None
            else [-(index + 1) for index in range(len(xyxy))]
        )

        tracked: list[TrackResult] = []
        for bbox, track_id, score, class_id in zip(
            xyxy, track_ids, confidences, class_ids, strict=False
        ):
            if int(class_id) not in PERSON_CLASS_IDS:
                continue
            x1, y1, x2, y2 = bbox
            centroid = bbox_centroid(x1, y1, x2, y2)
            tracked.append(
                TrackResult(
                    track_id=int(track_id),
                    bbox=(int(x1), int(y1), int(x2), int(y2)),
                    confidence=float(score),
                    centroid=centroid,
                    counting_point=centroid,
                )
            )

        return tracked

    def _track_with_config(self, model: Any, frame: np.ndarray, confidence: float) -> Any:
        started_at = monotonic()
        # Each camera owns an independent YOLO/tracker instance so that BoT-SORT
        # state can never leak across streams. GPU execution is serialized here
        # because the runtime and driver stack are shared process-wide.
        with _GLOBAL_INFERENCE_LOCK:
            results = model.track(
                frame,
                persist=True,
                tracker=self.tracker_config_path,
                classes=list(PERSON_CLASS_IDS),
                conf=confidence,
                device=self._device,
                half=self._use_half,
                imgsz=self.image_size,
                iou=self.nms_iou,
                max_det=self.max_detections,
                agnostic_nms=False,
                verbose=False,
            )
        completed_at = monotonic()
        self._record_inference_time(started_at, completed_at)
        return results

    def _benchmark_predict(self, model: Any) -> None:
        blank_frame = np.zeros((self.image_size, self.image_size, 3), dtype=np.uint8)
        for _ in range(3):
            started_at = monotonic()
            with _GLOBAL_INFERENCE_LOCK:
                model.predict(
                    blank_frame,
                    classes=list(PERSON_CLASS_IDS),
                    conf=0.25,
                    device=self._device,
                    half=self._use_half,
                    imgsz=self.image_size,
                    iou=self.nms_iou,
                    max_det=self.max_detections,
                    agnostic_nms=False,
                    verbose=False,
                )
            self._record_inference_time(started_at, monotonic())

    def _fallback_after_runtime_failure(self, exc: Exception) -> bool:
        with self._lock:
            fallback_profiles = PROFILE_FALLBACKS.get(self.effective_profile, ("emergency",))[1:]
            for profile in fallback_profiles:
                selection = resolve_detector_selection(
                    processing_profile=profile,
                    runtime_backend=self.requested_runtime,
                    tracker_profile=self.requested_tracker,
                )
                if (
                    selection.model_path is None
                    or selection.effective_profile == self.effective_profile
                ):
                    continue
                fallback_reason = (
                    f"{self.effective_profile} failed during model startup: {exc}. "
                    f"Fell back to {selection.effective_profile}."
                )
                self._apply_selection_locked(
                    replace(
                        selection,
                        fallback_reason=fallback_reason,
                        fallback_chain=(self.effective_profile, *selection.fallback_chain),
                    )
                )
                self._clear_loaded_model_locked()
                return True
        return False

    def _fallback_tracker_after_failure(self, exc: Exception) -> bool:
        with self._lock:
            if self.effective_tracker != "botsort":
                return False
            self.effective_tracker = "bytetrack"
            self.tracker_config_path = str(
                _tracker_config_path(self.effective_profile, "bytetrack")
            )
            self.fallback_reason = (
                f"BoT-SORT failed during tracking: {exc}. Fell back to ByteTrack."
            )
            return True

    def _selection_changed(self, selection: DetectorSelection) -> bool:
        return (
            selection.effective_profile != self.effective_profile
            or selection.runtime_backend != self.selected_runtime
            or selection.effective_tracker != self.effective_tracker
            or selection.model_name != self.model_name
            or selection.image_size != self.image_size
            or selection.nms_iou != self.nms_iou
            or selection.max_detections != self.max_detections
        )

    def _apply_selection_locked(self, selection: DetectorSelection) -> None:
        self.processing_profile = selection.requested_profile
        self.requested_profile = selection.requested_profile
        self.normalized_profile = selection.normalized_profile
        self.effective_profile = selection.effective_profile
        self.model_name = selection.model_name
        self.selected_runtime = selection.runtime_backend
        self.requested_runtime = selection.requested_runtime
        self.requested_tracker = selection.requested_tracker
        self.effective_tracker = selection.effective_tracker
        self.tracker_config_path = selection.tracker_config_path
        self.image_size = selection.image_size
        self.nms_iou = selection.nms_iou
        self.max_detections = selection.max_detections
        self.target_processing_fps = selection.target_processing_fps
        self.selection_reason = selection.selection_reason
        self.fallback_reason = selection.fallback_reason
        self.fallback_chain = selection.fallback_chain

    def _clear_loaded_model_locked(self) -> None:
        self._model = None
        self._warmed_up = False
        self._resolved_model_path = None
        self._device = "cpu"
        self._use_half = False

    def _profile_status_fields(self, availability: dict[str, Any]) -> dict[str, Any]:
        return {
            "processing_profile": self.effective_profile,
            "requested_processing_profile": self.requested_profile,
            "normalized_processing_profile": self.normalized_profile,
            "effective_processing_profile": self.effective_profile,
            "model_profile": self.effective_profile,
            "model_name": self.model_name,
            "selected_model": self.model_name,
            "selected_runtime": self.selected_runtime,
            "runtime_backend": self.selected_runtime,
            "runtime_device": self._device,
            "requested_runtime": self.requested_runtime,
            "selection_reason": self.selection_reason,
            "fallback_reason": self.fallback_reason,
            "fallback_chain": list(self.fallback_chain),
            "detector_image_size": self.image_size,
            "detector_nms_iou": self.nms_iou,
            "detector_max_detections": self.max_detections,
            "detector_person_class_ids": list(PERSON_CLASS_IDS),
            "target_processing_fps": self.target_processing_fps,
            "requested_tracker": self.requested_tracker,
            "effective_tracker": self.effective_tracker,
            "tracker_profile": self.effective_tracker,
            "tracker_config_path": self.tracker_config_path,
            "detector_model_availability": availability,
        }

    def _record_inference_time(self, started_at: float, completed_at: float) -> None:
        with self._telemetry_lock:
            self._inference_times_ms.append((completed_at - started_at) * 1000.0)
            if self._last_inference_at is not None:
                self._inference_intervals.append(completed_at - self._last_inference_at)
            self._last_inference_at = completed_at

    def _telemetry(self) -> dict[str, float | None]:
        with self._telemetry_lock:
            inference_times = sorted(self._inference_times_ms)
            average_interval = (
                sum(self._inference_intervals) / len(self._inference_intervals)
                if self._inference_intervals
                else None
            )
        return {
            "detector_p50_ms": _percentile(inference_times, 0.50),
            "detector_p95_ms": _percentile(inference_times, 0.95),
            "analytics_fps": 1.0 / average_interval
            if average_interval and average_interval > 0
            else None,
        }


def resolve_detector_selection(
    *,
    processing_profile: str,
    runtime_backend: str = "auto",
    tracker_profile: str = "auto",
    capabilities: dict[str, Any] | None = None,
    models_root: Path | None = None,
) -> DetectorSelection:
    return select_detector(
        processing_profile=processing_profile,
        runtime_backend=runtime_backend,
        tracker_profile=tracker_profile,
        capabilities=capabilities or get_runtime_capabilities(),
        models_root=models_root or _models_root(),
        tracker_config_path=_tracker_config_path,
    )


def get_detector_model_availability(models_root: Path | None = None) -> dict[str, Any]:
    return detector_model_availability(models_root or _models_root())


def _resolve_model_path_for(
    configured_model_path: str, profile_name: str, runtime: str
) -> Path | None:
    return resolve_model_path(configured_model_path, profile_name, runtime, _models_root())


def _tracker_config_path(profile_name: str, tracker: str) -> Path:
    detection_dir = Path(__file__).resolve().parent
    if tracker == "botsort":
        return detection_dir / "tracker_configs" / "botsort.yaml"
    return detection_dir / "tracker_configs" / "bytetrack.yaml"


def _models_root() -> Path:
    return model_directory()


def _percentile(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    index = min(len(values) - 1, max(0, int(round((len(values) - 1) * quantile))))
    return float(values[index])
