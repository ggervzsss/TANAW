"""Replay the existing detector cache with video timestamps, without new inference."""

import argparse
import json
from datetime import UTC, datetime
from math import ceil
from pathlib import Path
from statistics import median
from typing import Any

from app.analytics.open_space import AreaVisitTracker
from app.config.open_space_config import OpenSpaceConfig
from app.evaluation.detection_cache import load_detection_cache
from app.tracking import TrackIdentityResolver


def evaluate_dwell(
    truth: list[dict[str, Any]], predictions: list[dict[str, Any]]
) -> dict[str, Any]:
    """One-to-one temporal matching for controlled clips; no cross-person identity claim."""
    expected = [row for row in truth if row.get("complete", True)]
    actual = [row for row in predictions if row["status"] == "completed"]
    used: set[int] = set()
    errors = []
    ambiguous = 0
    for visit in actual:
        start = datetime.fromisoformat(visit["first_inside_at"]).timestamp()
        end = datetime.fromisoformat(visit["ended_at"]).timestamp()
        candidates = []
        for i, label in enumerate(expected):
            if i in used:
                continue
            left, right = label["entered_at_seconds"], label["exited_at_seconds"]
            intersection = max(0, min(end, right) - max(start, left))
            union = max(end, right) - min(start, left)
            score = intersection / union if union else 0
            if score >= 0.5:
                candidates.append((score, i))
        candidates.sort(reverse=True)
        if not candidates:
            continue
        if len(candidates) > 1 and candidates[0][0] - candidates[1][0] < 0.05:
            ambiguous += 1
            continue
        _, i = candidates[0]
        used.add(i)
        errors.append(
            abs(
                visit["estimated_dwell_ms"] / 1000
                - (expected[i]["exited_at_seconds"] - expected[i]["entered_at_seconds"])
            )
        )
    return {
        "completed_precision": len(used) / len(actual) if actual else None,
        "completed_recall": len(used) / len(expected) if expected else None,
        "matched_visits": len(used),
        "ground_truth_visits": len(expected),
        "predicted_completed_visits": len(actual),
        "ambiguous_matches": ambiguous,
        "median_absolute_error_seconds": median(errors) if errors else None,
        "p90_absolute_error_seconds": sorted(errors)[max(0, ceil(len(errors) * 0.9) - 1)]
        if errors
        else None,
        "matching": "temporal_overlap_controlled_clips_only",
    }


def replay(cache: Path, config: OpenSpaceConfig, confidence: float = 0.35) -> dict[str, Any]:
    metadata, frames = load_detection_cache(cache)
    if not frames:
        raise ValueError("The detector cache contains no frames.")
    tracker = AreaVisitTracker(config, wall_anchor=datetime(1970, 1, 1, tzinfo=UTC))
    resolver = TrackIdentityResolver(
        lost_track_ttl_seconds=config.gap_grace_seconds, motion_match_margin=0.15
    )
    visits = []
    last = None
    for frame in sorted(frames.values(), key=lambda f: f.timestamp):
        if last is not None and frame.timestamp <= last:
            raise ValueError("Cache timestamps must increase strictly.")
        if last is not None and frame.timestamp - last > 5:
            tracker.interrupt(frame.timestamp, "stream_interrupted")
            resolver.reset()
        tracks = resolver.resolve(
            list(frame.tracks), frame.timestamp, frame.frame_width, frame.frame_height
        )
        tracker.update(
            {
                t.track_id: (
                    t.counting_point.x / frame.frame_width,
                    t.counting_point.y / frame.frame_height,
                )
                for t in tracks
                if t.confidence >= confidence
            },
            frame.timestamp,
        )
        visits.extend(tracker.drain())
        last = frame.timestamp
    tracker.interrupt(last or 0, "end_of_recording")
    visits.extend(tracker.drain())
    return {
        "cache_fingerprint": metadata.fingerprint(),
        "video_sha256": metadata.video_sha256,
        "config": config.model_dump(mode="json"),
        "frame_count": len(frames),
        "algorithm_version": 1,
        "visits": visits,
        "limitation": "Cached replay does not validate live RTSP timing or camera accuracy.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--detections-cache", required=True, type=Path)
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--ground-truth", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    report = replay(
        args.detections_cache, OpenSpaceConfig.model_validate_json(args.config.read_text())
    )
    if args.ground_truth:
        report["evaluation"] = evaluate_dwell(
            json.loads(args.ground_truth.read_text())["visits"], report["visits"]
        )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "visits"}, indent=2))


if __name__ == "__main__":
    main()
