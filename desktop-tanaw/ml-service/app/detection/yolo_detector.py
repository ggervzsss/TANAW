from __future__ import annotations

import os
from collections import deque
from dataclasses import dataclass, replace
from pathlib import Path
from tempfile import gettempdir
from threading import Lock
from time import monotonic
from typing import Any

import numpy as np

from app.counting.geometry import Centroid, bbox_centroid
from app.runtime.hardware import get_runtime_capabilities

os.environ.setdefault("MPLCONFIGDIR", str(Path(gettempdir()) / "tanaw-matplotlib"))
os.environ.setdefault("YOLO_CONFIG_DIR", str(Path(gettempdir()) / "tanaw-ultralytics"))

PROCESSING_PROFILE_VALUES = {
    "auto",
    "compatibility",
    "balanced",
    "high_accuracy",
    "emergency",
}
RUNTIME_BACKEND_VALUES = {"auto", "cuda", "openvino", "cpu"}
TRACKER_PROFILE_VALUES = {"auto", "bytetrack", "botsort"}
PERSON_CLASS_IDS = (0,)
_GLOBAL_INFERENCE_LOCK = Lock()


@dataclass(frozen=True)
class DetectorProfile:
    name: str
    model_name: str
    image_size: int
    nms_iou: float
    max_detections: int
    preferred_runtimes: tuple[str, ...]
    target_processing_fps: float | None
    default_tracker: str
    default_reid_mode: str
    role: str
    optional: bool = False


@dataclass(frozen=True)
class DetectorSelection:
    requested_profile: str
    normalized_profile: str
    effective_profile: str
    model_name: str
    model_path: str | None
    runtime_backend: str
    requested_runtime: str
    requested_tracker: str
    effective_tracker: str
    tracker_config_path: str
    image_size: int
    nms_iou: float
    max_detections: int
    target_processing_fps: float | None
    selection_reason: str
    fallback_reason: str | None
    fallback_chain: tuple[str, ...]


@dataclass(frozen=True)
class TrackResult:
    track_id: int
    bbox: tuple[int, int, int, int]
    confidence: float
    centroid: Centroid
    counting_point: Centroid


DETECTOR_PROFILES: dict[str, DetectorProfile] = {
    "emergency": DetectorProfile(
        name="emergency",
        model_name="yolo11n",
        image_size=480,
        nms_iou=0.45,
        max_detections=32,
        preferred_runtimes=("openvino", "cpu", "cuda"),
        target_processing_fps=7.0,
        default_tracker="bytetrack",
        default_reid_mode="off",
        role="lowest-resource emergency fallback",
    ),
    "compatibility": DetectorProfile(
        name="compatibility",
        model_name="yolo11n",
        image_size=640,
        nms_iou=0.50,
        max_detections=64,
        preferred_runtimes=("cuda", "openvino", "cpu"),
        target_processing_fps=9.0,
        default_tracker="bytetrack",
        default_reid_mode="off",
        role="safe CPU and weaker-device profile",
    ),
    "balanced": DetectorProfile(
        name="balanced",
        model_name="yolo11s",
        image_size=640,
        nms_iou=0.55,
        max_detections=96,
        preferred_runtimes=("cuda", "openvino", "cpu"),
        target_processing_fps=12.0,
        default_tracker="botsort",
        default_reid_mode="fast",
        role="recommended capable-device profile",
    ),
    "high_accuracy": DetectorProfile(
        name="high_accuracy",
        model_name="yolo11m",
        image_size=640,
        nms_iou=0.55,
        max_detections=128,
        preferred_runtimes=("cuda", "openvino", "cpu"),
        target_processing_fps=12.0,
        default_tracker="botsort",
        default_reid_mode="fast",
        role="higher-accuracy dedicated GPU profile",
        optional=True,
    ),
}

PROFILE_FALLBACKS: dict[str, tuple[str, ...]] = {
    "emergency": ("emergency",),
    "compatibility": ("compatibility", "emergency"),
    "balanced": ("balanced", "compatibility", "emergency"),
    "high_accuracy": ("high_accuracy", "balanced", "compatibility", "emergency"),
}


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
    capabilities = capabilities or get_runtime_capabilities()
    models_root = models_root or _models_root()
    requested_profile = processing_profile if processing_profile else "auto"
    requested_runtime = runtime_backend if runtime_backend in RUNTIME_BACKEND_VALUES else "auto"
    requested_tracker = tracker_profile if tracker_profile in TRACKER_PROFILE_VALUES else "auto"
    normalized_profile = _normalize_processing_profile(requested_profile)

    if normalized_profile == "auto":
        starting_profile, selection_reason = _auto_profile(capabilities)
    else:
        starting_profile = normalized_profile
        selection_reason = f"Using requested {starting_profile} model profile."

    fallback_chain = PROFILE_FALLBACKS.get(starting_profile, ("compatibility", "emergency"))
    fallback_notes: list[str] = []
    for profile_name in fallback_chain:
        profile = DETECTOR_PROFILES[profile_name]
        for runtime in _runtime_candidates(profile, requested_runtime, capabilities):
            model_path = _first_existing_model_path(profile_name, runtime, models_root)
            if model_path is None:
                continue
            tracker, tracker_config_path, tracker_note = _resolve_tracker(
                profile_name, requested_tracker
            )
            if tracker_note is not None:
                fallback_notes.append(tracker_note)
            if profile_name != starting_profile:
                fallback_notes.append(
                    f"{DETECTOR_PROFILES[starting_profile].model_name} was unavailable; "
                    f"using {profile.model_name}."
                )
            if requested_runtime != "auto" and runtime != requested_runtime:
                fallback_notes.append(
                    f"Requested {requested_runtime} runtime was unavailable; using {runtime}."
                )
            return DetectorSelection(
                requested_profile=requested_profile,
                normalized_profile=normalized_profile,
                effective_profile=profile_name,
                model_name=profile.model_name,
                model_path=str(model_path),
                runtime_backend=runtime,
                requested_runtime=requested_runtime,
                requested_tracker=requested_tracker,
                effective_tracker=tracker,
                tracker_config_path=str(tracker_config_path),
                image_size=profile.image_size,
                nms_iou=profile.nms_iou,
                max_detections=profile.max_detections,
                target_processing_fps=profile.target_processing_fps,
                selection_reason=selection_reason,
                fallback_reason=" ".join(fallback_notes) or None,
                fallback_chain=_visible_fallback_chain(fallback_chain, profile_name),
            )
        fallback_notes.append(f"{profile.model_name} has no available model for usable runtimes.")

    profile = DETECTOR_PROFILES[starting_profile]
    tracker, tracker_config_path, tracker_note = _resolve_tracker(
        starting_profile, requested_tracker
    )
    if tracker_note is not None:
        fallback_notes.append(tracker_note)
    return DetectorSelection(
        requested_profile=requested_profile,
        normalized_profile=normalized_profile,
        effective_profile=starting_profile,
        model_name=profile.model_name,
        model_path=None,
        runtime_backend="cpu",
        requested_runtime=requested_runtime,
        requested_tracker=requested_tracker,
        effective_tracker=tracker,
        tracker_config_path=str(tracker_config_path),
        image_size=profile.image_size,
        nms_iou=profile.nms_iou,
        max_detections=profile.max_detections,
        target_processing_fps=profile.target_processing_fps,
        selection_reason=selection_reason,
        fallback_reason=" ".join(fallback_notes) or "No bundled detector model is available.",
        fallback_chain=fallback_chain,
    )


def get_detector_model_availability(models_root: Path | None = None) -> dict[str, Any]:
    root = models_root or _models_root()
    profiles: dict[str, Any] = {}
    for profile in DETECTOR_PROFILES.values():
        pt_path = root / f"{profile.model_name}.pt"
        openvino_paths = _openvino_model_paths(profile.model_name, profile.image_size, root)
        openvino_available = [path for path in openvino_paths if path.exists()]
        profiles[profile.name] = {
            "model": profile.model_name,
            "role": profile.role,
            "required": profile.name == "emergency",
            "optional": profile.optional,
            "available": pt_path.exists() or bool(openvino_available),
            "pt": {"path": str(pt_path), "exists": pt_path.exists()},
            "openvino": [{"path": str(path), "exists": path.exists()} for path in openvino_paths],
            "available_runtimes": _available_runtimes_for_profile(profile.name, root),
        }
    return profiles


def _normalize_processing_profile(processing_profile: str) -> str:
    if processing_profile in PROCESSING_PROFILE_VALUES:
        return processing_profile
    return "auto"


def _auto_profile(capabilities: dict[str, Any]) -> tuple[str, str]:
    if bool(capabilities.get("cuda_available")):
        return "balanced", "CUDA is available; selected balanced YOLO11s profile."
    if bool(capabilities.get("openvino_available")):
        return "compatibility", "OpenVINO is available; selected compatibility YOLO11n profile."
    return "emergency", "No accelerator runtime detected; selected emergency CPU YOLO11n profile."


def _runtime_candidates(
    profile: DetectorProfile, requested_runtime: str, capabilities: dict[str, Any]
) -> tuple[str, ...]:
    candidates: tuple[str, ...]
    if requested_runtime == "cpu":
        candidates = ("cpu",)
    elif requested_runtime == "openvino":
        candidates = ("openvino", "cpu")
    elif requested_runtime == "cuda":
        candidates = ("cuda", "cpu")
    else:
        candidates = (*profile.preferred_runtimes, "cpu")

    unique_candidates: list[str] = []
    for runtime in candidates:
        if runtime in unique_candidates:
            continue
        if _runtime_available(runtime, capabilities):
            unique_candidates.append(runtime)
    return tuple(unique_candidates)


def _visible_fallback_chain(
    fallback_chain: tuple[str, ...], effective_profile: str
) -> tuple[str, ...]:
    if effective_profile not in fallback_chain:
        return fallback_chain
    return fallback_chain[: fallback_chain.index(effective_profile) + 1]


def _runtime_available(runtime: str, capabilities: dict[str, Any]) -> bool:
    if runtime in {"auto", "cpu"}:
        return True
    runtime_available = capabilities.get("runtime_available")
    if isinstance(runtime_available, dict) and runtime in runtime_available:
        return bool(runtime_available[runtime])
    if runtime == "cuda":
        return bool(capabilities.get("cuda_available"))
    if runtime == "openvino":
        return bool(capabilities.get("openvino_available"))
    return False


def _first_existing_model_path(profile_name: str, runtime: str, models_root: Path) -> Path | None:
    profile = DETECTOR_PROFILES[profile_name]
    for path in _model_path_candidates(profile, runtime, models_root):
        if path.exists():
            return path
    return None


def _resolve_model_path_for(
    configured_model_path: str, profile_name: str, runtime: str
) -> Path | None:
    requested_path = Path(configured_model_path)
    if requested_path.is_absolute():
        if requested_path.exists():
            return requested_path
        raise FileNotFoundError(f"YOLO model file was not found at {requested_path}.")

    if configured_model_path != "yolo11n.pt":
        bundled_path = _models_root() / requested_path.name
        if bundled_path.exists():
            return bundled_path
        raise FileNotFoundError(f"YOLO model file was not found at {bundled_path}.")

    return _first_existing_model_path(profile_name, runtime, _models_root())


def _model_path_candidates(
    profile: DetectorProfile, runtime: str, models_root: Path
) -> tuple[Path, ...]:
    if runtime == "openvino":
        return tuple(_openvino_model_paths(profile.model_name, profile.image_size, models_root))
    return (models_root / f"{profile.model_name}.pt",)


def _openvino_model_paths(model_name: str, image_size: int, models_root: Path) -> tuple[Path, ...]:
    return (
        models_root / f"{model_name}_{image_size}_openvino_model",
        models_root / f"{model_name}_openvino_model",
    )


def _available_runtimes_for_profile(profile_name: str, models_root: Path) -> list[str]:
    profile = DETECTOR_PROFILES[profile_name]
    runtimes: list[str] = []
    if (models_root / f"{profile.model_name}.pt").exists():
        runtimes.extend(["cpu", "cuda"])
    if any(
        path.exists()
        for path in _openvino_model_paths(profile.model_name, profile.image_size, models_root)
    ):
        runtimes.append("openvino")
    return sorted(set(runtimes))


def _resolve_tracker(profile_name: str, requested_tracker: str) -> tuple[str, Path, str | None]:
    preferred_tracker = (
        DETECTOR_PROFILES[profile_name].default_tracker
        if requested_tracker == "auto"
        else requested_tracker
    )
    tracker_config_path = _tracker_config_path(profile_name, preferred_tracker)
    if preferred_tracker == "botsort" and not tracker_config_path.exists():
        return (
            "bytetrack",
            _tracker_config_path(profile_name, "bytetrack"),
            "BoT-SORT config was unavailable; using ByteTrack.",
        )
    return preferred_tracker, tracker_config_path, None


def _tracker_config_path(profile_name: str, tracker: str) -> Path:
    detection_dir = Path(__file__).resolve().parent
    if tracker == "botsort":
        return detection_dir / "tracker_configs" / "botsort.yaml"
    return detection_dir / "tracker_configs" / "bytetrack.yaml"


def _models_root() -> Path:
    return Path(__file__).resolve().parents[2] / "models"


def _percentile(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    index = min(len(values) - 1, max(0, int(round((len(values) - 1) * quantile))))
    return float(values[index])
