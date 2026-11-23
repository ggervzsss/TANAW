"""Camera pipeline doubles and builders shared by the camera, pipeline and regression tests."""

import threading
import time
from pathlib import Path
from typing import Any

import numpy as np

from app.camera.camera_manager import CameraProcessingManager, ProcessingSession
from app.camera.contracts import CameraCounts, CameraSessionState
from app.config.camera_config import (
    CameraCountingConfigUpdate,
    CameraStartRequest,
    RegionOfInterest,
)
from app.config.open_space_config import OpenSpaceConfig
from app.counting.geometry import Centroid
from app.counting.tripwire_counter import TripwireCounter
from app.detection.yolo_detector import TrackResult
from app.identity import UniqueVisitorRegistry
from app.reid import AsyncReIdWorker, PersonReIdentifier, TrackAppearanceBuffer
from app.storage.session_store import SessionStore

POLYGON = [{"x": 0.2, "y": 0.2}, {"x": 0.8, "y": 0.2}, {"x": 0.8, "y": 0.8}, {"x": 0.2, "y": 0.8}]


def open_space_configuration(**changes: Any) -> CameraStartRequest:
    return CameraStartRequest(
        stream_url="rtsp://192.168.1.20/stream2",
        camera_id=1,
        analysis_mode="open_space",
        roi=RegionOfInterest(top=0, left=0, width=1, height=1),
        open_space=OpenSpaceConfig.model_validate({"polygon": POLYGON}),
        **changes,
    )


class FakePipeline(CameraProcessingManager):
    def __init__(self, app_data_dir: str | None = None, camera_id: int | None = None) -> None:
        self.camera_id = camera_id
        self.running_value = False
        self.start_calls = 0
        self.stop_calls = 0
        self.close_calls = 0
        self.counting_update_calls = 0
        self.config: CameraStartRequest | None = None
        self.enterprise_id: str | None = None

    @property
    def running(self) -> bool:
        return self.running_value

    def use_establishment_registry(self, registry: Any) -> None:
        self.establishment_registry = registry

    @property
    def current_config(self) -> CameraStartRequest | None:
        return self.config

    def bind_enterprise(
        self,
        enterprise_id: str,
        enterprise_name: str | None = None,
        *,
        restore_session: bool = True,
    ) -> dict:
        self.enterprise_id = enterprise_id
        return {
            "enterprise_id": enterprise_id,
            "enterprise_name": enterprise_name,
            "changed": True,
            "session_restored": False,
        }

    def start(self, config: CameraStartRequest, should_continue: Any = None) -> None:
        if self.running_value:
            self.stop()
        self.config = config
        self.start_calls += 1
        self.running_value = True

    def stop(self) -> None:
        self.stop_calls += 1
        self.running_value = False

    def close(self) -> None:
        self.close_calls += 1
        self.stop()

    def update_counting_config(self, update: CameraCountingConfigUpdate) -> dict[str, object]:
        self.counting_update_calls += 1
        return {
            "camera_id": self.camera_id,
            "session_id": 1,
            "raw_frame_id": 10,
            "stream_frame_id": 10,
        }

    def counts(self) -> CameraCounts:
        return {
            "entry": self.camera_id or 0,
            "exit": 0,
            "occupancy": 999,
            "running": self.running_value,
            "status": "running" if self.running_value else "stopped",
            "started_at": None,
            "error": None,
        }

    def detections(self) -> dict:
        return {"running": self.running_value, "status": "running", "tracks": []}

    def session(self) -> CameraSessionState:
        return {
            "running": self.running_value,
            "status": "running",
            "error": None,
            "camera_id": self.camera_id,
            "camera_name": f"Camera {self.camera_id}",
            "camera_config": None,
            "counts": self.counts(),
            "updated_at": None,
        }

    def model_status(self) -> dict:
        return {}


def pipeline_config(camera_id: int) -> CameraStartRequest:
    return CameraStartRequest(
        camera_id=camera_id,
        camera_name=f"Camera {camera_id}",
        stream_url="rtsp://192.168.1.20/stream2",
    )


def processing_session(session_id: int, **config_values: Any) -> ProcessingSession:
    return ProcessingSession(
        session_id=session_id,
        config=CameraStartRequest(stream_url="rtsp://192.168.1.20/stream2", **config_values),
        stop_event=threading.Event(),
        event_scope=f"test-{session_id}",
    )


def flush_pending(manager: CameraProcessingManager, session: ProcessingSession) -> None:
    manager._flush_pending_entry_events(session, time.monotonic() + 1.0, force=True)


def manager_with_store(directory: str) -> CameraProcessingManager:
    manager = CameraProcessingManager(directory)
    manager._session_store = SessionStore(str(Path(directory)))
    manager._visitor_registry = UniqueVisitorRegistry(manager._session_store, model_name="test")
    manager._reidentifier = PersonReIdentifier(model_path=str(Path(directory) / "missing.onnx"))
    # Keep these deterministic counting tests independent of installed real ReID assets.
    manager._reid_worker.close()
    manager._quality_reid_worker.close()
    manager._quality_reidentifier = PersonReIdentifier(
        model_path=str(Path(directory) / "missing-quality.onnx")
    )
    manager._reid_worker = AsyncReIdWorker(manager._reidentifier)
    manager._quality_reid_worker = AsyncReIdWorker(manager._quality_reidentifier)
    manager._appearance_buffer = TrackAppearanceBuffer()
    manager._counter = TripwireCounter(tripwire_position=0.5)
    manager._counter.reset()
    return manager


def track_result(
    track_id: int, bbox: tuple[int, int, int, int], confidence: float = 0.9
) -> TrackResult:
    x1, y1, x2, y2 = bbox
    center = Centroid((x1 + x2) / 2, (y1 + y2) / 2)
    return TrackResult(
        track_id=track_id,
        bbox=bbox,
        confidence=confidence,
        centroid=center,
        counting_point=center,
    )


class FakeTracker:
    def __init__(self, responses: list[list[TrackResult]]) -> None:
        self._responses = responses
        self.seen_confidences: list[float] = []

    def track_people(self, frame: np.ndarray, confidence: float) -> list[TrackResult]:
        self.seen_confidences.append(confidence)
        return self._responses.pop(0)

    def reset_tracking(self, *, restart_ids: bool = True) -> None:
        self.resets = getattr(self, "resets", 0) + 1
