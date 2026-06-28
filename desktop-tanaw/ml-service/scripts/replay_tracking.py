import argparse
import json
from pathlib import Path
from time import monotonic
from typing import Any

import cv2
import numpy as np

from app.config.camera_config import CameraStartRequest, TripwireLine
from app.counting.tripwire_counter import TripwireCounter
from app.detection.yolo_detector import YoloPersonTracker
from app.tracking import TrackIdentityResolver


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Replay a recorded clip through TANAW detection, tracking, and counting."
    )
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--profile", choices=["auto", "cpu", "accelerated"], default="auto")
    parser.add_argument("--confidence", type=float, default=0.35)
    parser.add_argument("--sample-fps", type=float)
    args = parser.parse_args()

    config_payload = _load_config(args.config)
    config_payload.update(
        {
            "stream_url": "0",
            "processing_profile": args.profile,
            "confidence": args.confidence,
        }
    )
    config = CameraStartRequest(**config_payload)

    tracker = YoloPersonTracker()
    effective_profile = tracker.configure(config.processing_profile)
    tracker.warmup()
    tracker.reset_tracking()
    resolver = TrackIdentityResolver(lost_track_ttl_seconds=min(config.track_ttl_seconds, 3.0))
    counter = TripwireCounter(
        tripwire_position=config.tripwire_position,
        entry_line=_normalized_line(config.entry_line),
        exit_line=_normalized_line(config.exit_line),
        reverse_direction=config.reverse_direction,
        event_cooldown_seconds=config.event_cooldown_seconds,
        track_ttl_seconds=config.track_ttl_seconds,
    )
    counter.reset()

    capture = cv2.VideoCapture(str(args.video))
    if not capture.isOpened():
        raise RuntimeError(f"Unable to open {args.video}.")

    source_fps = capture.get(cv2.CAP_PROP_FPS)
    if source_fps <= 0:
        source_fps = 30.0
    sample_fps = args.sample_fps or (15.0 if effective_profile == "accelerated" else 8.0)
    sample_every = max(1, int(round(source_fps / max(sample_fps, 1.0))))
    args.output.parent.mkdir(parents=True, exist_ok=True)

    frame_index = -1
    with args.output.open("w", encoding="utf-8") as output:
        while True:
            ok, frame = capture.read()
            if not ok or frame is None:
                break
            frame_index += 1
            if frame_index % sample_every != 0:
                continue

            frame = _resize(
                frame,
                config.max_frame_width or (960 if effective_profile == "accelerated" else 640),
            )
            frame_height, frame_width = frame.shape[:2]
            timestamp = frame_index / source_fps
            started_at = monotonic()
            source_tracks = tracker.track_people(frame, config.confidence)
            tracks = resolver.resolve(source_tracks, timestamp, frame_width, frame_height)
            counter.begin_frame(timestamp)
            events = []
            for track in tracks:
                if track.confidence < config.confidence or not _inside_roi(
                    track.counting_point.x,
                    track.counting_point.y,
                    frame_width,
                    frame_height,
                    config,
                ):
                    continue
                direction = counter.update(
                    track.track_id, track.counting_point, frame_width, frame_height
                )
                if direction is not None:
                    events.append({"track_id": track.track_id, "direction": direction})
            processing_ms = (monotonic() - started_at) * 1000.0

            output.write(
                json.dumps(
                    {
                        "frame_index": frame_index,
                        "timestamp": timestamp,
                        "tracks": [
                            {
                                "track_id": track.track_id,
                                "source_track_id": track.source_track_id,
                                "bbox": list(track.bbox),
                                "confidence": track.confidence,
                                "identity_state": track.identity_state,
                            }
                            for track in tracks
                        ],
                        "events": events,
                        "processing_ms": processing_ms,
                        "frame_age_ms": 0.0,
                    },
                    sort_keys=True,
                )
            )
            output.write("\n")

    capture.release()
    print(f"Wrote {args.output}")


def _load_config(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Replay config must be a JSON object.")
    payload.pop("stream_url", None)
    return payload


def _normalized_line(
    line: TripwireLine | None,
) -> tuple[tuple[float, float], tuple[float, float]] | None:
    if line is None:
        return None
    return ((line.start.x, line.start.y), (line.end.x, line.end.y))


def _inside_roi(
    x: float, y: float, frame_width: int, frame_height: int, config: CameraStartRequest
) -> bool:
    normalized_x = x / max(frame_width, 1)
    normalized_y = y / max(frame_height, 1)
    roi = config.roi
    return (
        roi.left <= normalized_x <= roi.left + roi.width
        and roi.top <= normalized_y <= roi.top + roi.height
    )


def _resize(frame: np.ndarray, max_width: int) -> np.ndarray:
    height, width = frame.shape[:2]
    if width <= max_width:
        return frame
    scale = max_width / width
    return cv2.resize(frame, (max_width, int(height * scale)), interpolation=cv2.INTER_AREA)


if __name__ == "__main__":
    main()
