from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from time import monotonic
from typing import Any

import cv2
import numpy as np


@dataclass(frozen=True)
class EmbeddingResult:
    embedding: np.ndarray
    inference_ms: float


class PersonReIdentifier:
    def __init__(
        self,
        model_path: str = "person_reid_cpu.onnx",
        input_size: tuple[int, int] = (128, 256),
        model_name: str = "torchreid_osnet_x0_25_msmt17_onnx",
        mask_head_region: bool = False,
    ) -> None:
        self.model_path = model_path
        self.input_size = input_size
        self.model_name = model_name
        self.mask_head_region = mask_head_region
        self._session: Any | None = None
        self._input_name: str | None = None
        self._output_name: str | None = None
        self._providers: list[str] = []
        self._resolved_model_path: str | None = None
        self._status = "not_loaded"
        self._error: str | None = None
        self._loading = False
        self._ready = False
        self._total_inference_ms = 0.0
        self._inference_count = 0
        self._lock = Lock()

    def status(self) -> dict[str, bool | int | float | str | list[str] | None]:
        if not self._lock.acquire(blocking=False):
            return {
                "reid_model_loaded": self._session is not None,
                "reid_model_ready": self._ready,
                "reid_model_loading": True,
                "reid_status": "loading",
                "reid_model_path": self._resolved_model_path,
                "reid_error": self._error,
                "reid_average_inference_ms": self._average_inference_ms(),
                "reid_providers": list(self._providers),
            }

        try:
            return {
                "reid_model_loaded": self._session is not None,
                "reid_model_ready": self._ready,
                "reid_model_loading": self._loading,
                "reid_status": self._status,
                "reid_model_path": self._resolved_model_path,
                "reid_error": self._error,
                "reid_average_inference_ms": self._average_inference_ms(),
                "reid_providers": list(self._providers),
            }
        finally:
            self._lock.release()

    def warmup(self) -> None:
        session = self._load_session()
        if session is None:
            return

        blank = np.zeros((self.input_size[1], self.input_size[0], 3), dtype=np.uint8)
        self.embed_crop(blank)
        with self._lock:
            self._ready = True
            self._status = "ready"

    def embed(self, frame: np.ndarray, bbox: tuple[int, int, int, int]) -> EmbeddingResult | None:
        crop = _crop(frame, bbox)
        if crop is None:
            return None
        return self.embed_crop(crop)

    def embed_crop(self, crop: np.ndarray) -> EmbeddingResult | None:
        session = self._load_session()
        if session is None or self._input_name is None or self._output_name is None:
            return None

        tensor = self._preprocess(crop)
        started_at = monotonic()
        try:
            outputs = session.run([self._output_name], {self._input_name: tensor})
        except Exception as exc:
            with self._lock:
                self._ready = False
                self._status = "degraded"
                self._error = str(exc)
            return None
        inference_ms = (monotonic() - started_at) * 1000.0
        embedding = np.asarray(outputs[0]).reshape(-1).astype(np.float32)
        norm = float(np.linalg.norm(embedding))
        if norm <= 1e-9:
            return None

        embedding = embedding / norm
        with self._lock:
            self._ready = True
            self._status = "ready"
            self._total_inference_ms += inference_ms
            self._inference_count += 1

        return EmbeddingResult(embedding=embedding, inference_ms=inference_ms)

    def _load_session(self) -> Any | None:
        with self._lock:
            if self._session is not None:
                if self._status == "degraded":
                    return None
                return self._session
            if self._status == "degraded" and self._error is not None:
                return None

            self._loading = True

        try:
            import onnxruntime as ort

            model_source = self._resolve_model_path()
            available_providers = ort.get_available_providers()
            preferred_providers = [
                provider
                for provider in (
                    "CUDAExecutionProvider",
                    "OpenVINOExecutionProvider",
                    "CPUExecutionProvider",
                )
                if provider in available_providers
            ]
            session_options = ort.SessionOptions()
            session_options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            session_options.intra_op_num_threads = (
                1 if preferred_providers == ["CPUExecutionProvider"] else 0
            )
            session_options.inter_op_num_threads = 1
            session = ort.InferenceSession(
                model_source, sess_options=session_options, providers=preferred_providers
            )
            input_name = session.get_inputs()[0].name
            output_name = session.get_outputs()[0].name
        except Exception as exc:
            with self._lock:
                self._session = None
                self._ready = False
                self._status = "degraded"
                self._error = str(exc)
                self._loading = False
            return None

        with self._lock:
            self._session = session
            self._input_name = input_name
            self._output_name = output_name
            self._providers = list(session.get_providers())
            self._resolved_model_path = model_source
            self._status = "loaded"
            self._error = None
            self._loading = False
            return self._session

    def _resolve_model_path(self) -> str:
        requested_path = Path(self.model_path)
        if requested_path.is_absolute():
            if requested_path.exists():
                return str(requested_path)
            raise FileNotFoundError(f"ReID model file was not found at {requested_path}.")

        service_root = Path(__file__).resolve().parents[2]
        bundled_path = service_root / "models" / requested_path.name
        if bundled_path.exists():
            return str(bundled_path)

        fallback_path = service_root / "models" / "person_reid.onnx"
        if requested_path.name == "person_reid_cpu.onnx" and fallback_path.exists():
            self.model_name = "torchreid_osnet_ain_x1_0_msmt17_onnx"
            return str(fallback_path)

        raise FileNotFoundError(
            f"ReID model file was not found at {bundled_path}. "
            "Unique visitor counting will run in degraded mode until a bundled ONNX model is available."
        )

    def _preprocess(self, crop: np.ndarray) -> np.ndarray:
        image = crop.copy()
        if self.mask_head_region:
            head_height = max(1, int(image.shape[0] * 0.18))
            image[:head_height, :] = 0

        image = cv2.resize(image, self.input_size, interpolation=cv2.INTER_AREA)
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        image = (image - np.array([0.485, 0.456, 0.406], dtype=np.float32)) / np.array(
            [0.229, 0.224, 0.225], dtype=np.float32
        )
        return np.transpose(image, (2, 0, 1))[None, :, :, :].astype(np.float32)

    def _average_inference_ms(self) -> float | None:
        if self._inference_count <= 0:
            return None
        return self._total_inference_ms / self._inference_count


def _crop(frame: np.ndarray, bbox: tuple[int, int, int, int]) -> np.ndarray | None:
    height, width = frame.shape[:2]
    x1, y1, x2, y2 = bbox
    x1 = max(0, min(width - 1, int(x1)))
    y1 = max(0, min(height - 1, int(y1)))
    x2 = max(0, min(width, int(x2)))
    y2 = max(0, min(height, int(y2)))
    if x2 <= x1 or y2 <= y1:
        return None
    return frame[y1:y2, x1:x2]
