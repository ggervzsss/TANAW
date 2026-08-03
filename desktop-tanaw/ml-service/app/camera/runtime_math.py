from typing import Any


def safe_int(value: Any) -> int:
    return value if isinstance(value, int) else 0


def age_ms(now: float, observed_at: float | None) -> float | None:
    if observed_at is None:
        return None
    return max(0.0, (now - observed_at) * 1000.0)


def seconds_to_frames(seconds: float, processing_fps: float) -> int:
    return max(1, int(round(seconds * max(processing_fps, 1.0))))


def processing_fps(configured_fps: float | None, tracker_target_fps: float | None) -> float:
    if configured_fps is not None:
        return max(configured_fps, 1.0)
    return tracker_target_fps if tracker_target_fps is not None else 8.0


def max_frame_width(configured_width: int | None, processing_profile: str) -> int:
    if configured_width is not None:
        return configured_width
    return 960 if processing_profile in {"balanced", "high_accuracy"} else 640


def resolve_reid_mode(requested_mode: str, processing_profile: str) -> str:
    if requested_mode in {"off", "fast", "quality"}:
        return requested_mode
    if processing_profile == "high_accuracy":
        return "quality"
    if processing_profile == "balanced":
        return "fast"
    return "off"


def fast_reid_enabled(mode: str) -> bool:
    return mode in {"fast", "quality"}


def quality_reid_enabled(mode: str) -> bool:
    return mode == "quality"


def counting_debug(
    counter_debug: dict[str, Any] | None,
    track_id: int,
    *,
    inside_roi: bool,
    counting_confidence_passed: bool,
    tracking_confidence: float,
    counting_confidence: float,
) -> dict[str, Any]:
    debug = counter_debug or {}
    reason = "eligible"
    if not counting_confidence_passed:
        reason = "below_counting_confidence"
    elif not inside_roi:
        reason = "outside_roi"
    return {
        **debug,
        "counting_track_id": track_id,
        "roi_passed": inside_roi,
        "counting_confidence_passed": counting_confidence_passed,
        "tracking_confidence": tracking_confidence,
        "counting_confidence": counting_confidence,
        "reason": debug.get("last_reason") or reason,
    }
