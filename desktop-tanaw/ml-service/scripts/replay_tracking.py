import argparse
import json
from collections import Counter
from pathlib import Path
from statistics import mean
from time import monotonic
from typing import Any, cast

import cv2
import numpy as np

from app.config.camera_config import CameraStartRequest, TripwireLine
from app.counting.tripwire_counter import TripwireCounter
from app.detection.yolo_detector import DETECTOR_PROFILES, YoloPersonTracker
from app.evaluation.detection_cache import (
    CachedDetectionFrame,
    DetectionCacheMetadata,
    DetectionCacheWriter,
    load_detection_cache,
    sha256_file,
    validate_detection_cache,
)
from app.evaluation.replay_reid import ReplayReIdCoordinator
from app.reid import ReIdReplayMode
from app.tracking import TrackIdentityResolver

PROCESSING_PROFILE_CHOICES = [
    "auto",
    "compatibility",
    "balanced",
    "high_accuracy",
    "emergency",
]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Replay a recorded clip through TANAW detection, tracking, and counting."
    )
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--config", type=Path)
    parser.add_argument("--profile", choices=PROCESSING_PROFILE_CHOICES, default="auto")
    parser.add_argument(
        "--runtime",
        choices=["auto", "cuda", "openvino", "cpu"],
        default="auto",
    )
    parser.add_argument("--tracker", choices=["auto", "bytetrack", "botsort"], default="auto")
    parser.add_argument("--tracking-confidence", type=float, default=0.15)
    parser.add_argument("--counting-confidence", type=float, default=0.35)
    parser.add_argument("--sample-fps", type=float)
    parser.add_argument("--summary-output", type=Path)
    parser.add_argument("--annotated-output", type=Path)
    parser.add_argument(
        "--reid",
        choices=["off", "fast", "quality"],
        default="off",
        help="Appearance pipeline to replay. Defaults to off for an explicit baseline.",
    )
    parser.add_argument(
        "--detections-cache",
        type=Path,
        help="Optional JSONL cache that makes ReID variants reuse identical YOLO/BoT-SORT tracks.",
    )
    parser.add_argument(
        "--rebuild-cache",
        action="store_true",
        help="Replace --detections-cache instead of loading it.",
    )
    parser.add_argument(
        "--crop-normalized",
        nargs=4,
        type=float,
        metavar=("LEFT", "TOP", "WIDTH", "HEIGHT"),
        help="Optional evaluation-only crop for screen recordings that contain the camera view.",
    )
    args = parser.parse_args()
    if args.rebuild_cache and args.detections_cache is None:
        parser.error("--rebuild-cache requires --detections-cache.")
    if not args.video.is_file():
        parser.error(f"Video does not exist: {args.video}")

    config_payload = _load_config(args.config)
    config_payload.update(
        {
            "stream_url": "rtsp://192.168.1.20/stream2",
            "processing_profile": args.profile,
            "runtime_backend": args.runtime,
            "tracker_profile": args.tracker,
            "tracking_confidence": args.tracking_confidence,
            "counting_confidence": args.counting_confidence,
            "reid_mode": args.reid,
        }
    )
    config = CameraStartRequest(**config_payload)

    tracker = YoloPersonTracker()
    effective_profile = tracker.configure(
        config.processing_profile, config.runtime_backend, config.tracker_profile
    )
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
    target_fps = DETECTOR_PROFILES[effective_profile].target_processing_fps or 8.0
    sample_fps = args.sample_fps or target_fps
    sample_every = max(1, int(round(source_fps / max(sample_fps, 1.0))))
    max_frame_width = config.max_frame_width or (
        960 if effective_profile in {"balanced", "high_accuracy"} else 640
    )
    cache_metadata = DetectionCacheMetadata(
        video_sha256=sha256_file(args.video),
        source_fps=source_fps,
        source_frame_count=int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0),
        sample_every=sample_every,
        crop_normalized=tuple(args.crop_normalized) if args.crop_normalized is not None else None,
        processing_profile=effective_profile,
        runtime_backend=tracker.selected_runtime,
        tracker_profile=tracker.effective_tracker,
        tracking_confidence=config.tracking_confidence,
        max_frame_width=max_frame_width,
        model_name=tracker.model_name,
        detector_image_size=tracker.image_size,
        detector_nms_iou=tracker.nms_iou,
        detector_max_detections=tracker.max_detections,
    )
    cached_frames: dict[int, CachedDetectionFrame] | None = None
    cache_writer: DetectionCacheWriter | None = None
    if (
        args.detections_cache is not None
        and args.detections_cache.is_file()
        and not args.rebuild_cache
    ):
        cached_metadata, cached_frames = load_detection_cache(args.detections_cache)
        validate_detection_cache(cached_metadata, cache_metadata)
    else:
        tracker.warmup()
        tracker.reset_tracking()
        if args.detections_cache is not None:
            cache_writer = DetectionCacheWriter(args.detections_cache, cache_metadata)

    reid = ReplayReIdCoordinator(cast(ReIdReplayMode, args.reid))
    args.output.parent.mkdir(parents=True, exist_ok=True)

    processing_times_ms: list[float] = []
    detector_times_ms: list[float] = []
    association_times_ms: list[float] = []
    track_counts: list[int] = []
    event_counts: Counter[str] = Counter()
    unique_stable_tracks: set[int] = set()
    unique_source_tracks: set[int] = set()
    previous_source_by_stable: dict[int, int] = {}
    source_track_switches = 0
    zero_track_frames = 0
    multi_track_frames = 0
    low_confidence_tracks = 0
    outside_roi_tracks = 0
    processed_frames = 0
    source_frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    video_duration_seconds = source_frame_count / source_fps if source_fps else 0.0
    writer: cv2.VideoWriter | None = None

    frame_index = -1
    try:
        with args.output.open("w", encoding="utf-8") as output:
            while True:
                ok, frame = capture.read()
                if not ok or frame is None:
                    break
                frame_index += 1
                if frame_index % sample_every != 0:
                    continue

                if args.crop_normalized is not None:
                    frame = _crop_normalized(frame, tuple(args.crop_normalized))
                frame = _resize(frame, max_frame_width)
                frame_height, frame_width = frame.shape[:2]
                timestamp = frame_index / source_fps

                detector_started_at = monotonic()
                cached_frame = cached_frames.get(frame_index) if cached_frames is not None else None
                if cached_frames is not None and cached_frame is None:
                    raise ValueError(
                        f"Detection cache is missing sampled frame {frame_index}. "
                        "Re-run with --rebuild-cache."
                    )
                if cached_frame is not None:
                    if (cached_frame.frame_width, cached_frame.frame_height) != (
                        frame_width,
                        frame_height,
                    ):
                        raise ValueError(
                            f"Detection cache frame {frame_index} has dimensions "
                            f"{cached_frame.frame_width}x{cached_frame.frame_height}, expected "
                            f"{frame_width}x{frame_height}."
                        )
                    source_tracks = list(cached_frame.tracks)
                    detector_ms = cached_frame.detector_ms
                else:
                    source_tracks = tracker.track_people(frame, config.tracking_confidence)
                    detector_ms = (monotonic() - detector_started_at) * 1000.0
                    if cache_writer is not None:
                        cache_writer.write_frame(
                            CachedDetectionFrame(
                                frame_index=frame_index,
                                timestamp=timestamp,
                                frame_width=frame_width,
                                frame_height=frame_height,
                                detector_ms=detector_ms,
                                tracks=tuple(source_tracks),
                            )
                        )

                association_started_at = monotonic()
                identity_updates = reid.begin_frame(
                    resolver,
                    counter,
                    counter.frame_index + 1,
                    timestamp,
                )
                tracks = resolver.resolve(source_tracks, timestamp, frame_width, frame_height)
                counter.begin_frame(timestamp)
                events: list[dict[str, int | str]] = []
                eligible_tracks = []
                for track in tracks:
                    inside_roi = _inside_roi(
                        track,
                        frame_width,
                        frame_height,
                        config,
                    )
                    if track.confidence < config.counting_confidence:
                        low_confidence_tracks += 1
                        continue
                    if not inside_roi:
                        outside_roi_tracks += 1
                        continue
                    eligible_tracks.append(track)
                    directions = counter.update_many(
                        track.track_id,
                        track.counting_point,
                        frame_width,
                        frame_height,
                        track.bbox,
                    )
                    for direction in directions:
                        events.append({"track_id": track.track_id, "direction": direction})
                        event_counts[direction] += 1
                reid.sample_tracks(
                    frame,
                    eligible_tracks,
                    counter.frame_index,
                    frame_width,
                    frame_height,
                )
                association_ms = (monotonic() - association_started_at) * 1000.0
                processing_ms = detector_ms + association_ms

                processed_frames += 1
                processing_times_ms.append(processing_ms)
                detector_times_ms.append(detector_ms)
                association_times_ms.append(association_ms)
                track_counts.append(len(tracks))
                if not tracks:
                    zero_track_frames += 1
                if len(tracks) > 1:
                    multi_track_frames += 1
                for track in tracks:
                    unique_stable_tracks.add(track.track_id)
                    unique_source_tracks.add(track.source_track_id)
                    previous_source = previous_source_by_stable.get(track.track_id)
                    if previous_source is not None and previous_source != track.source_track_id:
                        source_track_switches += 1
                    previous_source_by_stable[track.track_id] = track.source_track_id

                output.write(
                    json.dumps(
                        {
                            "frame_index": frame_index,
                            "timestamp": timestamp,
                            "requested_profile": config.processing_profile,
                            "effective_profile": effective_profile,
                            "runtime_backend": tracker.selected_runtime,
                            "tracker_profile": tracker.effective_tracker,
                            "model_name": tracker.model_name,
                            "detector_image_size": tracker.image_size,
                            "detector_nms_iou": tracker.nms_iou,
                            "detector_max_detections": tracker.max_detections,
                            "reid_mode": args.reid,
                            "detection_cache": str(args.detections_cache)
                            if args.detections_cache
                            else None,
                            "tracks": [
                                {
                                    "track_id": track.track_id,
                                    "source_track_id": track.source_track_id,
                                    "bbox": list(track.bbox),
                                    "confidence": track.confidence,
                                    "centroid": [track.centroid.x, track.centroid.y],
                                    "trigger_point": [
                                        track.counting_point.x,
                                        track.counting_point.y,
                                    ],
                                    "identity_state": track.identity_state,
                                }
                                for track in tracks
                            ],
                            "events": events,
                            "identity_updates": identity_updates,
                            "detector_ms": detector_ms,
                            "association_ms": association_ms,
                            "processing_ms": processing_ms,
                            "frame_age_ms": 0.0,
                        },
                        sort_keys=True,
                    )
                )
                output.write("\n")

                if args.annotated_output is not None:
                    if writer is None:
                        args.annotated_output.parent.mkdir(parents=True, exist_ok=True)
                        writer = _open_video_writer(
                            args.annotated_output, sample_fps, frame_width, frame_height
                        )
                    writer.write(_annotated_frame(frame, tracks, events, counter.counts.as_dict()))
    finally:
        capture.release()
        if cache_writer is not None:
            cache_writer.close()
        if writer is not None:
            writer.release()

    canonical_unique_stable_tracks = resolver.canonical_track_ids(unique_stable_tracks)
    summary = {
        "video": str(args.video),
        "source_frames": source_frame_count,
        "source_fps": source_fps,
        "duration_seconds": video_duration_seconds,
        "processed_frames": processed_frames,
        "sample_fps": sample_fps,
        "sample_every": sample_every,
        "requested_profile": config.processing_profile,
        "effective_profile": effective_profile,
        "runtime_backend": tracker.selected_runtime,
        "tracker_profile": tracker.effective_tracker,
        "model_name": tracker.model_name,
        "detector_image_size": tracker.image_size,
        "detector_nms_iou": tracker.nms_iou,
        "detector_max_detections": tracker.max_detections,
        "reid": reid.status(),
        "detection_cache": str(args.detections_cache) if args.detections_cache else None,
        "detection_cache_reused": cached_frames is not None,
        "tracking_confidence": config.tracking_confidence,
        "counting_confidence": config.counting_confidence,
        "crop_normalized": args.crop_normalized,
        "average_tracks_per_frame": mean(track_counts) if track_counts else 0.0,
        "max_tracks_per_frame": max(track_counts, default=0),
        "zero_track_frames": zero_track_frames,
        "multi_track_frames": multi_track_frames,
        "low_confidence_tracks": low_confidence_tracks,
        "outside_roi_tracks": outside_roi_tracks,
        "unique_stable_tracks": len(canonical_unique_stable_tracks),
        "unique_stable_tracks_before_reid_remaps": len(unique_stable_tracks),
        "unique_source_tracks": len(unique_source_tracks),
        "source_track_switches": source_track_switches,
        "identity": resolver.status(),
        "events": dict(event_counts),
        "entry_count": counter.counts.entry,
        "exit_count": counter.counts.exit,
        "final_occupancy": counter.counts.occupancy,
        "average_processing_ms": mean(processing_times_ms) if processing_times_ms else 0.0,
        "average_detector_ms": mean(detector_times_ms) if detector_times_ms else 0.0,
        "average_association_ms": mean(association_times_ms) if association_times_ms else 0.0,
        "p50_processing_ms": _percentile(processing_times_ms, 0.50),
        "p95_processing_ms": _percentile(processing_times_ms, 0.95),
        "analytics_fps": (1000.0 / mean(processing_times_ms) if processing_times_ms else 0.0),
        "jsonl_output": str(args.output),
        "annotated_output": str(args.annotated_output) if args.annotated_output else None,
    }
    if args.summary_output is not None:
        args.summary_output.parent.mkdir(parents=True, exist_ok=True)
        args.summary_output.write_text(json.dumps(summary, indent=2, sort_keys=True), "utf-8")

    print(json.dumps(summary, indent=2, sort_keys=True))


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
) -> tuple[tuple[float, float], ...] | None:
    if line is None:
        return None
    points = line.sampled_points or line.points
    if points:
        return tuple((point.x, point.y) for point in points)
    return ((line.start.x, line.start.y), (line.end.x, line.end.y))


def _inside_roi(
    track: Any,
    frame_width: int,
    frame_height: int,
    config: CameraStartRequest,
) -> bool:
    roi = config.roi
    roi_left = roi.left * frame_width
    roi_top = roi.top * frame_height
    roi_right = (roi.left + roi.width) * frame_width
    roi_bottom = (roi.top + roi.height) * frame_height

    def point_inside(x: float, y: float) -> bool:
        return roi_left <= x <= roi_right and roi_top <= y <= roi_bottom

    if point_inside(track.counting_point.x, track.counting_point.y) or point_inside(
        track.centroid.x, track.centroid.y
    ):
        return True

    x1, y1, x2, y2 = track.bbox
    box_left = max(0.0, float(min(x1, x2)))
    box_top = max(0.0, float(min(y1, y2)))
    box_right = min(float(frame_width), float(max(x1, x2)))
    box_bottom = min(float(frame_height), float(max(y1, y2)))
    box_area = max(0.0, box_right - box_left) * max(0.0, box_bottom - box_top)
    if box_area <= 0:
        return False

    overlap_area = max(0.0, min(box_right, roi_right) - max(box_left, roi_left)) * max(
        0.0, min(box_bottom, roi_bottom) - max(box_top, roi_top)
    )
    return overlap_area / box_area >= 0.25


def _resize(frame: np.ndarray, max_width: int) -> np.ndarray:
    height, width = frame.shape[:2]
    if width <= max_width:
        return frame
    scale = max_width / width
    return cv2.resize(frame, (max_width, int(height * scale)), interpolation=cv2.INTER_AREA)


def _crop_normalized(frame: np.ndarray, crop: tuple[float, float, float, float]) -> np.ndarray:
    height, width = frame.shape[:2]
    left, top, crop_width, crop_height = crop
    x1 = min(width - 1, max(0, int(round(left * width))))
    y1 = min(height - 1, max(0, int(round(top * height))))
    x2 = min(width, max(x1 + 1, int(round((left + crop_width) * width))))
    y2 = min(height, max(y1 + 1, int(round((top + crop_height) * height))))
    return frame[y1:y2, x1:x2]


def _open_video_writer(
    path: Path, fps: float, frame_width: int, frame_height: int
) -> cv2.VideoWriter:
    fourcc = int(cast(Any, cv2).VideoWriter_fourcc(*"mp4v"))
    writer = cv2.VideoWriter(str(path), fourcc, max(fps, 1.0), (frame_width, frame_height))
    if not writer.isOpened():
        raise RuntimeError(f"Unable to create annotated output video at {path}.")
    return writer


def _annotated_frame(
    frame: np.ndarray,
    tracks: list[Any],
    events: list[dict[str, int | str]],
    counts: dict[str, int | str | None],
) -> np.ndarray:
    annotated = frame.copy()
    event_by_track = {
        int(event["track_id"]): str(event["direction"])
        for event in events
        if isinstance(event.get("track_id"), int)
    }
    for track in tracks:
        x1, y1, x2, y2 = track.bbox
        direction = event_by_track.get(track.track_id)
        color = (33, 214, 122) if direction != "exit" else (70, 70, 255)
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
        cv2.circle(
            annotated,
            (int(track.counting_point.x), int(track.counting_point.y)),
            5,
            (255, 255, 0),
            -1,
            cv2.LINE_AA,
        )
        label = f"#{track.track_id} {track.confidence:.2f}"
        if direction is not None:
            label = f"{label} {direction.upper()}"
        cv2.putText(
            annotated,
            label,
            (x1, max(18, y1 - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            color,
            2,
            cv2.LINE_AA,
        )

    status = (
        f"entry={counts.get('entry', 0)} exit={counts.get('exit', 0)} "
        f"occupancy={counts.get('occupancy', 0)}"
    )
    cv2.rectangle(annotated, (8, 8), (360, 42), (16, 32, 28), -1)
    cv2.putText(
        annotated,
        status,
        (18, 31),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        (230, 255, 245),
        2,
        cv2.LINE_AA,
    )
    return annotated


def _percentile(values: list[float], quantile: float) -> float | None:
    if not values:
        return None
    sorted_values = sorted(values)
    index = min(
        len(sorted_values) - 1,
        max(0, int(round((len(sorted_values) - 1) * quantile))),
    )
    return float(sorted_values[index])


if __name__ == "__main__":
    main()
