from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

from app.config.camera_config import RegionOfInterest, TripwireLine

NormalizedPath = tuple[tuple[float, float], ...]


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


class CameraFrameRenderer:
    def render_display_frame(
        self,
        frame: np.ndarray,
        tracks: list[DisplayTrack],
        tripwire_position: float,
        entry_line: NormalizedPath | None,
        exit_line: NormalizedPath | None,
        roi: RegionOfInterest,
        reverse_direction: bool,
    ) -> np.ndarray:
        height, width = frame.shape[:2]
        self._draw_roi(frame, roi, width, height)
        if entry_line is not None or exit_line is not None:
            self._draw_tripwire_line(frame, entry_line, width, height, "ENTRY", (74, 222, 128))
            self._draw_tripwire_line(frame, exit_line, width, height, "EXIT", (248, 113, 113))
        else:
            line_x = int(width * tripwire_position)

            cv2.line(frame, (line_x, 0), (line_x, height), (59, 130, 246), 2)
            if reverse_direction:
                cv2.putText(
                    frame,
                    "ENTRY",
                    (max(8, line_x - 70), 22),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.48,
                    (74, 222, 128),
                    1,
                    cv2.LINE_AA,
                )
                cv2.putText(
                    frame,
                    "EXIT",
                    (line_x + 10, 22),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.48,
                    (248, 113, 113),
                    1,
                    cv2.LINE_AA,
                )
            else:
                cv2.putText(
                    frame,
                    "EXIT",
                    (max(8, line_x - 54), 22),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.48,
                    (248, 113, 113),
                    1,
                    cv2.LINE_AA,
                )
                cv2.putText(
                    frame,
                    "ENTRY",
                    (line_x + 10, 22),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.48,
                    (74, 222, 128),
                    1,
                    cv2.LINE_AA,
                )

        for track in tracks:
            x1, y1, x2, y2 = track.bbox
            color = (
                (74, 222, 128)
                if track.direction == "entry"
                else (248, 113, 113)
                if track.direction == "exit"
                else (34, 197, 94)
            )

            self._draw_track_box(frame, (x1, y1, x2, y2), color)
            cv2.circle(frame, track.trigger_point, 4, (34, 211, 238), -1)
            if track.track_id > 0:
                source_suffix = (
                    f" | src {track.source_track_id}"
                    if track.source_track_id != track.track_id
                    else ""
                )
                label = f"#{track.track_id}{source_suffix}"
            else:
                label = "Person"
            self._draw_track_label(frame, x1, y1, f"{label} | {track.confidence * 100:.0f}%", color)

        return frame

    def _draw_track_box(
        self, frame: np.ndarray, bbox: tuple[int, int, int, int], color: tuple[int, int, int]
    ) -> None:
        frame_height, frame_width = frame.shape[:2]
        x1, y1, x2, y2 = bbox
        left = max(0, min(frame_width - 1, min(x1, x2)))
        top = max(0, min(frame_height - 1, min(y1, y2)))
        right = max(0, min(frame_width - 1, max(x1, x2)))
        bottom = max(0, min(frame_height - 1, max(y1, y2)))
        if right <= left or bottom <= top:
            return

        overlay = frame.copy()
        cv2.rectangle(overlay, (left, top), (right, bottom), color, -1)
        cv2.addWeighted(overlay, 0.07, frame, 0.93, 0, frame)

        shadow = (15, 23, 42)
        cv2.rectangle(frame, (left, top), (right, bottom), shadow, 1)

        width = right - left
        height = bottom - top
        corner = max(10, min(28, int(min(width, height) * 0.28)))
        thickness = 2
        line_type = cv2.LINE_AA

        cv2.line(frame, (left, top), (left + corner, top), color, thickness, line_type)
        cv2.line(frame, (left, top), (left, top + corner), color, thickness, line_type)
        cv2.line(frame, (right, top), (right - corner, top), color, thickness, line_type)
        cv2.line(frame, (right, top), (right, top + corner), color, thickness, line_type)
        cv2.line(frame, (left, bottom), (left + corner, bottom), color, thickness, line_type)
        cv2.line(frame, (left, bottom), (left, bottom - corner), color, thickness, line_type)
        cv2.line(frame, (right, bottom), (right - corner, bottom), color, thickness, line_type)
        cv2.line(frame, (right, bottom), (right, bottom - corner), color, thickness, line_type)

    def _draw_track_label(
        self, frame: np.ndarray, x: int, y: int, label: str, color: tuple[int, int, int]
    ) -> None:
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.38
        thickness = 1
        padding_x = 5
        padding_y = 3
        text_size, baseline = cv2.getTextSize(label, font, font_scale, thickness)
        text_width, text_height = text_size
        label_width = text_width + padding_x * 2
        label_height = text_height + padding_y * 2 + baseline

        frame_height, frame_width = frame.shape[:2]
        left = max(0, min(x, frame_width - label_width - 1))
        top = y - label_height - 3
        if top < 0:
            top = min(frame_height - label_height - 1, y + 3)
        top = max(0, top)
        right = min(frame_width - 1, left + label_width)
        bottom = min(frame_height - 1, top + label_height)

        overlay = frame.copy()
        cv2.rectangle(overlay, (left, top), (right, bottom), (15, 23, 42), -1)
        cv2.addWeighted(overlay, 0.78, frame, 0.22, 0, frame)
        cv2.rectangle(frame, (left, top), (right, bottom), color, 1)
        cv2.rectangle(frame, (left, top), (min(right, left + 3), bottom), color, -1)
        cv2.putText(
            frame,
            label,
            (left + padding_x, bottom - padding_y - baseline),
            font,
            font_scale,
            (255, 255, 255),
            thickness,
            cv2.LINE_AA,
        )

    def _draw_roi(
        self, frame: np.ndarray, roi: RegionOfInterest, frame_width: int, frame_height: int
    ) -> None:
        x1 = int(roi.left * frame_width)
        y1 = int(roi.top * frame_height)
        x2 = int((roi.left + roi.width) * frame_width)
        y2 = int((roi.top + roi.height) * frame_height)
        cv2.rectangle(frame, (x1, y1), (x2, y2), (59, 130, 246), 2)
        cv2.putText(
            frame,
            "ROI",
            (x1 + 6, max(18, y1 - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            (59, 130, 246),
            1,
            cv2.LINE_AA,
        )

    def _draw_tripwire_line(
        self,
        frame: np.ndarray,
        line: NormalizedPath | None,
        frame_width: int,
        frame_height: int,
        label: str,
        color: tuple[int, int, int],
    ) -> None:
        if line is None:
            return

        points = [(int(x * frame_width), int(y * frame_height)) for x, y in line]
        if len(points) < 2:
            return

        for start, end in zip(points, points[1:], strict=False):
            cv2.line(frame, start, end, color, 2)
        cv2.circle(frame, points[0], 4, color, -1)
        cv2.circle(frame, points[-1], 4, color, -1)
        cv2.putText(
            frame,
            label,
            (points[0][0] + 6, max(18, points[0][1] - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.48,
            color,
            1,
            cv2.LINE_AA,
        )

    def normalized_line(self, line: TripwireLine | None) -> NormalizedPath | None:
        if line is None:
            return None

        points = line.sampled_points or line.points or [line.start, line.end]
        return tuple((point.x, point.y) for point in points)

    def resize_for_processing(self, frame: np.ndarray, max_width: int) -> np.ndarray:
        height, width = frame.shape[:2]
        if width <= max_width:
            return frame

        scale = max_width / width
        return cv2.resize(frame, (max_width, int(height * scale)), interpolation=cv2.INTER_AREA)

    def encode_frame(self, frame: np.ndarray) -> bytes:
        ok, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
        if not ok:
            raise RuntimeError("Failed to encode processed frame.")
        return buffer.tobytes()

    def build_status_frame(self, message: str) -> bytes:
        frame = np.zeros((540, 960, 3), dtype=np.uint8)
        frame[:] = (17, 24, 39)
        cv2.line(frame, (480, 0), (480, 540), (59, 130, 246), 2)
        cv2.putText(
            frame,
            "TANAW ML Camera Service",
            (270, 236),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.85,
            (255, 255, 255),
            2,
            cv2.LINE_AA,
        )
        cv2.putText(
            frame,
            message[:72],
            (90, 288),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (203, 213, 225),
            2,
            cv2.LINE_AA,
        )
        return self.encode_frame(frame)
