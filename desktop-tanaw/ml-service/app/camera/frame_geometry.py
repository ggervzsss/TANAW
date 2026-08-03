import numpy as np

from app.config.camera_config import RegionOfInterest
from app.counting.geometry import Centroid


def track_inside_roi(
    counting_point: Centroid,
    centroid: Centroid,
    bbox: tuple[int, int, int, int],
    frame_width: int,
    frame_height: int,
    roi: RegionOfInterest,
) -> bool:
    return (
        _point_inside_roi(counting_point, frame_width, frame_height, roi)
        or _point_inside_roi(centroid, frame_width, frame_height, roi)
        or _bbox_overlaps_roi(bbox, frame_width, frame_height, roi)
    )


def crop_track(frame: np.ndarray, bbox: tuple[int, int, int, int]) -> np.ndarray | None:
    frame_height, frame_width = frame.shape[:2]
    x1, y1, x2, y2 = bbox
    x1 = max(0, min(frame_width - 1, x1))
    y1 = max(0, min(frame_height - 1, y1))
    x2 = max(0, min(frame_width, x2))
    y2 = max(0, min(frame_height, y2))
    if x2 <= x1 or y2 <= y1:
        return None
    return frame[y1:y2, x1:x2].copy()


def _point_inside_roi(
    point: Centroid, frame_width: int, frame_height: int, roi: RegionOfInterest
) -> bool:
    x = point.x / max(frame_width, 1)
    y = point.y / max(frame_height, 1)
    return roi.left <= x <= roi.left + roi.width and roi.top <= y <= roi.top + roi.height


def _bbox_overlaps_roi(
    bbox: tuple[int, int, int, int],
    frame_width: int,
    frame_height: int,
    roi: RegionOfInterest,
) -> bool:
    x1, y1, x2, y2 = bbox
    box_left = max(0.0, float(min(x1, x2)))
    box_top = max(0.0, float(min(y1, y2)))
    box_right = min(float(frame_width), float(max(x1, x2)))
    box_bottom = min(float(frame_height), float(max(y1, y2)))
    box_area = max(0.0, box_right - box_left) * max(0.0, box_bottom - box_top)
    if box_area <= 0:
        return False
    overlap_area = max(
        0.0,
        min(box_right, (roi.left + roi.width) * frame_width)
        - max(box_left, roi.left * frame_width),
    ) * max(
        0.0,
        min(box_bottom, (roi.top + roi.height) * frame_height)
        - max(box_top, roi.top * frame_height),
    )
    return overlap_area / box_area >= 0.25
