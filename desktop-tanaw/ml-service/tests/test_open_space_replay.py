from datetime import UTC, datetime
from pathlib import Path

from scripts.replay_open_space import evaluate_dwell


def visit(a: float, b: float) -> dict:
    return {
        "status": "completed",
        "first_inside_at": datetime.fromtimestamp(a, UTC).isoformat(),
        "ended_at": datetime.fromtimestamp(b, UTC).isoformat(),
        "estimated_dwell_ms": round((b - a) * 1000),
    }


def test_dwell_evaluation_reports_missing_visits_instead_of_only_matched_error() -> None:
    truth = [
        {"entered_at_seconds": 1, "exited_at_seconds": 5},
        {"entered_at_seconds": 10, "exited_at_seconds": 20},
    ]
    result = evaluate_dwell(truth, [visit(1, 5)])
    assert result["completed_recall"] == 0.5
    assert result["completed_precision"] == 1
    assert result["median_absolute_error_seconds"] == 0


def test_ambiguous_temporal_matches_are_not_reported_as_perfect_accuracy() -> None:
    truth = [{"entered_at_seconds": 1, "exited_at_seconds": 5}] * 2
    result = evaluate_dwell(truth, [visit(1, 5)])
    assert result["matched_visits"] == 0
    assert result["ambiguous_matches"] == 1
    assert result["median_absolute_error_seconds"] is None


def test_recorded_cache_replay_uses_source_time_and_completes_one_visit(tmp_path: Path) -> None:
    from app.config.open_space_config import OpenSpaceConfig
    from app.counting.geometry import Centroid
    from app.detection.yolo_detector import TrackResult
    from app.evaluation.detection_cache import (
        CachedDetectionFrame,
        DetectionCacheMetadata,
        DetectionCacheWriter,
    )
    from scripts.replay_open_space import replay

    metadata = DetectionCacheMetadata(
        video_sha256="0" * 64,
        source_fps=10,
        source_frame_count=80,
        sample_every=10,
        crop_normalized=None,
        processing_profile="balanced",
        runtime_backend="cpu",
        tracker_profile="botsort",
        tracking_confidence=0.15,
        max_frame_width=100,
        model_name="synthetic",
        detector_image_size=640,
        detector_nms_iou=0.55,
        detector_max_detections=96,
    )
    cache = tmp_path / "source.jsonl"
    with DetectionCacheWriter(cache, metadata) as writer:
        for second, x in enumerate([18, 22, 30, 40, 60, 70, 82, 90]):
            track = TrackResult(1, (x - 5, 20, x + 5, 50), 0.9, Centroid(x, 35), Centroid(x, 50))
            writer.write_frame(
                CachedDetectionFrame(second * 10, float(second), 100, 100, 1, (track,))
            )
    zone = OpenSpaceConfig.model_validate(
        {
            "polygon": [
                {"x": 0.2, "y": 0.2},
                {"x": 0.8, "y": 0.2},
                {"x": 0.8, "y": 0.8},
                {"x": 0.2, "y": 0.8},
            ]
        }
    )
    result = replay(cache, zone)
    assert result["frame_count"] == 8
    completed = [v for v in result["visits"] if v["status"] == "completed"]
    assert len(completed) == 1
    assert completed[0]["estimated_dwell_ms"] == 4000
