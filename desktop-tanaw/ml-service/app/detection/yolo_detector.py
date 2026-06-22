import os
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from tempfile import gettempdir
from threading import Lock
from time import monotonic
from typing import Any

import numpy as np

from app.counting.geometry import Centroid, bbox_bottom_center, bbox_centroid

os.environ.setdefault("MPLCONFIGDIR", str(Path(gettempdir()) / "tanaw-matplotlib"))
os.environ.setdefault("YOLO_CONFIG_DIR", str(Path(gettempdir()) / "tanaw-ultralytics"))


@dataclass(frozen=True)
class TrackResult:
    track_id: int
    bbox: tuple[int, int, int, int]
    confidence: float
    centroid: Centroid
    counting_point: Centroid


class YoloPersonTracker:
    def __init__(
        self, model_path: str = "yolov8n.pt", image_size: int = 480, max_detections: int = 32
    ) -> None:
        self.model_path = model_path
        self.image_size = image_size
        self.max_detections = max_detections
        self.processing_profile = "auto"
        self.effective_profile = "cpu"
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

    def status(self) -> dict[str, bool | float | int | str | None]:
        telemetry = self._telemetry()
        if not self._lock.acquire(blocking=False):
            return {
                "model_loaded": self._model is not None,
                "model_ready": self._warmed_up,
                "device": self._device,
                "model_path": self._resolved_model_path,
                "model_loading": True,
                "processing_profile": self.effective_profile,
                "detector_image_size": self.image_size,
                **telemetry,
            }

        try:
            return {
                "model_loaded": self._model is not None,
                "model_ready": self._warmed_up,
                "device": self._device,
                "model_path": self._resolved_model_path,
                "model_loading": self._loading,
                "processing_profile": self.effective_profile,
                "detector_image_size": self.image_size,
                **telemetry,
            }
        finally:
            self._lock.release()

    def configure(self, processing_profile: str) -> str:
        import torch

        requested = (
            processing_profile if processing_profile in {"auto", "cpu", "accelerated"} else "auto"
        )
        accelerated = torch.cuda.is_available()
        effective = "accelerated" if requested == "accelerated" and accelerated else "cpu"
        if requested == "auto":
            effective = "accelerated" if accelerated else "cpu"

        with self._lock:
            profile_changed = effective != self.effective_profile
            self.processing_profile = requested
            self.effective_profile = effective
            self.image_size = 640 if effective == "accelerated" else 480
            self.max_detections = 64 if effective == "accelerated" else 32
            if profile_changed and self._model is not None:
                self._model = None
                self._warmed_up = False
                self._resolved_model_path = None
        return effective

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
        requested_path = Path(self.model_path)
        if requested_path.is_absolute():
            if requested_path.exists():
                return str(requested_path)
            raise FileNotFoundError(f"YOLO model file was not found at {requested_path}.")

        service_root = Path(__file__).resolve().parents[2]
        if self.effective_profile == "cpu":
            for model_directory in ("yolov8n_480_openvino_model", "yolov8n_openvino_model"):
                openvino_path = service_root / "models" / model_directory
                if openvino_path.exists():
                    return str(openvino_path)
        bundled_path = service_root / "models" / requested_path.name
        if bundled_path.exists():
            return str(bundled_path)

        raise FileNotFoundError(
            f"YOLO model file was not found at {bundled_path}. "
            "Ensure the bundled model exists under ml-service/models."
        )

    def _load_model(self) -> Any:
        with self._lock:
            if self._model is not None:
                return self._model

            import torch
            from ultralytics import YOLO

            model_source = self._resolve_model_path()
            try:
                self._loading = True
                self._model = YOLO(model_source, task="detect")
                self._resolved_model_path = model_source
                self._device = "cuda:0" if torch.cuda.is_available() else "cpu"
                self._use_half = self._device.startswith("cuda")
                try:
                    self._model.fuse()
                except Exception:
                    pass
            finally:
                self._loading = False
            return self._model

    def warmup(self) -> None:
        with self._warmup_lock:
            with self._lock:
                if self._warmed_up:
                    return

            model = self._load_model()

            blank_frame = np.zeros((self.image_size, self.image_size, 3), dtype=np.uint8)
            model.predict(
                blank_frame,
                classes=[0],
                conf=0.25,
                device=self._device,
                half=self._use_half,
                imgsz=self.image_size,
                max_det=self.max_detections,
                verbose=False,
            )
            with self._lock:
                self._warmed_up = True

    def track_people(self, frame: np.ndarray, confidence: float) -> list[TrackResult]:
        model = self._load_model()
        started_at = monotonic()
        results = model.track(
            frame,
            persist=True,
            tracker=str(
                Path(__file__).with_name(
                    "tanaw_bytetrack_accelerated.yaml"
                    if self.effective_profile == "accelerated"
                    else "tanaw_bytetrack.yaml"
                )
            ),
            classes=[0],
            conf=min(confidence, 0.10),
            device=self._device,
            half=self._use_half,
            imgsz=self.image_size,
            iou=0.45,
            max_det=self.max_detections,
            verbose=False,
        )
        completed_at = monotonic()
        with self._telemetry_lock:
            self._inference_times_ms.append((completed_at - started_at) * 1000.0)
            if self._last_inference_at is not None:
                self._inference_intervals.append(completed_at - self._last_inference_at)
            self._last_inference_at = completed_at

        if not results:
            return []

        boxes = results[0].boxes
        if boxes is None:
            return []

        xyxy = boxes.xyxy.cpu().tolist()
        confidences = boxes.conf.cpu().tolist()
        track_ids = (
            boxes.id.int().cpu().tolist()
            if boxes.id is not None
            else [-(index + 1) for index in range(len(xyxy))]
        )

        tracked: list[TrackResult] = []
        for bbox, track_id, score in zip(xyxy, track_ids, confidences, strict=False):
            x1, y1, x2, y2 = bbox
            centroid = bbox_centroid(x1, y1, x2, y2)
            counting_point = bbox_bottom_center(x1, y1, x2, y2)
            tracked.append(
                TrackResult(
                    track_id=int(track_id),
                    bbox=(int(x1), int(y1), int(x2), int(y2)),
                    confidence=float(score),
                    centroid=centroid,
                    counting_point=counting_point,
                )
            )

        return tracked

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


def _percentile(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    index = min(len(values) - 1, max(0, int(round((len(values) - 1) * quantile))))
    return float(values[index])
