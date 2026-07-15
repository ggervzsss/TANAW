from __future__ import annotations

import threading
from dataclasses import dataclass
from typing import Any

import numpy as np

from app.config.camera_config import CameraStartRequest, RegionOfInterest
from app.tracking import ResolvedTrack

NormalizedPath = tuple[tuple[float, float], ...]


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
