from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, TextIO

from app.counting.geometry import Centroid
from app.detection.yolo_detector import TrackResult

DETECTION_CACHE_SCHEMA_VERSION = 1


@dataclass(frozen=True)
class DetectionCacheMetadata:
    video_sha256: str
    source_fps: float
    source_frame_count: int
    sample_every: int
    crop_normalized: tuple[float, float, float, float] | None
    processing_profile: str
    runtime_backend: str
    tracker_profile: str
    tracking_confidence: float
    max_frame_width: int
    model_name: str
    detector_image_size: int
    detector_nms_iou: float
    detector_max_detections: int
    schema_version: int = DETECTION_CACHE_SCHEMA_VERSION

    def fingerprint(self) -> str:
        payload = json.dumps(asdict(self), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class CachedDetectionFrame:
    frame_index: int
    timestamp: float
    frame_width: int
    frame_height: int
    detector_ms: float
    tracks: tuple[TrackResult, ...]


class DetectionCacheWriter:
    def __init__(self, path: Path, metadata: DetectionCacheMetadata) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._file: TextIO = path.open("w", encoding="utf-8")
        self._write(
            {
                "type": "metadata",
                "metadata": asdict(metadata),
                "fingerprint": metadata.fingerprint(),
            }
        )

    def write_frame(self, frame: CachedDetectionFrame) -> None:
        self._write(
            {
                "type": "frame",
                "frame_index": frame.frame_index,
                "timestamp": frame.timestamp,
                "frame_width": frame.frame_width,
                "frame_height": frame.frame_height,
                "detector_ms": frame.detector_ms,
                "tracks": [_serialize_track(track) for track in frame.tracks],
            }
        )

    def close(self) -> None:
        self._file.close()

    def __enter__(self) -> DetectionCacheWriter:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def _write(self, payload: dict[str, Any]) -> None:
        self._file.write(json.dumps(payload, sort_keys=True))
        self._file.write("\n")


def load_detection_cache(
    path: Path,
) -> tuple[DetectionCacheMetadata, dict[int, CachedDetectionFrame]]:
    metadata: DetectionCacheMetadata | None = None
    frames: dict[int, CachedDetectionFrame] = {}
    with path.open("r", encoding="utf-8") as cache_file:
        for line_number, line in enumerate(cache_file, start=1):
            if not line.strip():
                continue
            payload = json.loads(line)
            record_type = payload.get("type")
            if record_type == "metadata":
                if metadata is not None or line_number != 1:
                    raise ValueError(f"{path}:{line_number} has misplaced cache metadata.")
                raw_metadata = payload.get("metadata")
                if not isinstance(raw_metadata, dict):
                    raise ValueError(f"{path}:{line_number} has invalid cache metadata.")
                metadata = DetectionCacheMetadata(**raw_metadata)
                if metadata.schema_version != DETECTION_CACHE_SCHEMA_VERSION:
                    raise ValueError(
                        f"Unsupported detection cache schema {metadata.schema_version}; "
                        f"expected {DETECTION_CACHE_SCHEMA_VERSION}."
                    )
                if payload.get("fingerprint") != metadata.fingerprint():
                    raise ValueError(f"{path}:{line_number} metadata fingerprint is invalid.")
                continue
            if record_type != "frame":
                raise ValueError(f"{path}:{line_number} has unknown record type {record_type!r}.")
            if metadata is None:
                raise ValueError(f"{path}:{line_number} appears before cache metadata.")
            frame = _deserialize_frame(payload)
            if frame.frame_index in frames:
                raise ValueError(f"{path}:{line_number} repeats frame {frame.frame_index}.")
            frames[frame.frame_index] = frame

    if metadata is None:
        raise ValueError(f"{path} does not contain detection cache metadata.")
    return metadata, frames


def validate_detection_cache(
    cached: DetectionCacheMetadata,
    expected: DetectionCacheMetadata,
) -> None:
    if cached.fingerprint() == expected.fingerprint():
        return

    changed = [
        key
        for key, expected_value in asdict(expected).items()
        if asdict(cached).get(key) != expected_value
    ]
    raise ValueError(
        "Detection cache does not match this video/replay configuration. "
        f"Changed fields: {', '.join(changed)}. Re-run with --rebuild-cache."
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _serialize_track(track: TrackResult) -> dict[str, int | float | list[int] | list[float]]:
    return {
        "track_id": track.track_id,
        "bbox": list(track.bbox),
        "confidence": track.confidence,
        "centroid": [track.centroid.x, track.centroid.y],
        "counting_point": [track.counting_point.x, track.counting_point.y],
    }


def _deserialize_frame(payload: dict[str, Any]) -> CachedDetectionFrame:
    return CachedDetectionFrame(
        frame_index=int(payload["frame_index"]),
        timestamp=float(payload["timestamp"]),
        frame_width=int(payload["frame_width"]),
        frame_height=int(payload["frame_height"]),
        detector_ms=float(payload["detector_ms"]),
        tracks=tuple(_deserialize_track(track) for track in payload.get("tracks", [])),
    )


def _deserialize_track(payload: dict[str, Any]) -> TrackResult:
    bbox = payload["bbox"]
    centroid = payload["centroid"]
    counting_point = payload["counting_point"]
    return TrackResult(
        track_id=int(payload["track_id"]),
        bbox=(int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])),
        confidence=float(payload["confidence"]),
        centroid=Centroid(float(centroid[0]), float(centroid[1])),
        counting_point=Centroid(float(counting_point[0]), float(counting_point[1])),
    )
