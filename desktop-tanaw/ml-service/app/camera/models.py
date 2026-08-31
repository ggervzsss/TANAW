import threading
from dataclasses import dataclass

import numpy as np

from app.camera.frame_renderer import DisplayTrack, NormalizedPath
from app.config.camera_config import CameraStartRequest, RegionOfInterest
from app.tracking import ResolvedTrack


class CameraStreamUnavailableError(ValueError):
    pass


@dataclass(slots=True)
class RuntimeState:
    running: bool = False
    status: str = "stopped"
    error: str | None = None


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


@dataclass(slots=True)
class ProcessingSession:
    session_id: int
    config: CameraStartRequest
    stop_event: threading.Event
    event_scope: str


@dataclass(frozen=True, slots=True)
class PendingEntryEvent:
    session_id: int
    track: ResolvedTrack
    direction: str
    created_at: float
    expires_at: float
