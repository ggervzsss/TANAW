from dataclasses import dataclass, field
from datetime import UTC, datetime
from math import hypot

from app.counting.geometry import Centroid

NormalizedPath = tuple[tuple[float, float], ...]


@dataclass
class CountSnapshot:
    entry: int = 0
    exit: int = 0
    occupancy: int = 0
    started_at: datetime | None = None

    def as_dict(self) -> dict[str, int | str | None]:
        return {
            "entry": self.entry,
            "exit": self.exit,
            "occupancy": self.occupancy,
            "started_at": self.started_at.isoformat() if self.started_at else None,
        }


@dataclass
class TrackState:
    point: Centroid
    first_seen_frame: int
    last_seen_frame: int
    first_seen_at: float | None = None
    last_seen_at: float | None = None
    line_sides: dict[str, int] = field(default_factory=dict)
    cooldowns: dict[str, int] = field(default_factory=dict)
    cooldown_until: dict[str, float] = field(default_factory=dict)
    pending_line: str | None = None
    pending_started_frame: int | None = None
    pending_started_at: float | None = None
    last_crossed_line: str | None = None
    last_counted_direction: str | None = None
    last_reason: str | None = None
    last_movement_delta: float | None = None


@dataclass
class TripwireCounter:
    tripwire_position: float = 0.5
    entry_line: NormalizedPath | None = None
    exit_line: NormalizedPath | None = None
    reverse_direction: bool = False
    side_margin_px: float = 6.0
    min_crossing_distance_px: float = 10.0
    event_cooldown_frames: int = 18
    track_ttl_frames: int = 45
    event_cooldown_seconds: float = 3.6
    track_ttl_seconds: float = 9.0
    min_track_age_frames: int = 1
    min_track_age_seconds: float = 0.0
    paired_line_max_gap_frames: int = 90
    paired_line_max_gap_seconds: float = 18.0
    counts: CountSnapshot = field(default_factory=CountSnapshot)
    frame_index: int = 0
    tracks: dict[int, TrackState] = field(default_factory=dict)
    current_time: float | None = None

    def reset(self) -> None:
        self.counts = CountSnapshot(started_at=datetime.now(UTC))
        self.frame_index = 0
        self.current_time = None
        self.tracks.clear()

    def line_x(self, frame_width: int) -> int:
        return int(frame_width * self.tripwire_position)

    def begin_frame(self, now: float | None = None) -> None:
        self.frame_index += 1
        self.current_time = now
        stale_before_frame = self.frame_index - self.track_ttl_frames
        for track_id, state in list(self.tracks.items()):
            stale_by_time = (
                now is not None
                and state.last_seen_at is not None
                and now - state.last_seen_at > self.track_ttl_seconds
            )
            stale_by_frame = now is None and state.last_seen_frame < stale_before_frame
            if stale_by_time or stale_by_frame:
                del self.tracks[track_id]
            else:
                self._expire_pending_sequence(state)

    def update(
        self, track_id: int, point: Centroid, frame_width: int, frame_height: int
    ) -> str | None:
        directions = self.update_many(track_id, point, frame_width, frame_height)
        return directions[0] if directions else None

    def update_many(
        self,
        track_id: int,
        point: Centroid,
        frame_width: int,
        frame_height: int,
        _bbox: tuple[int, int, int, int] | None = None,
    ) -> list[str]:
        lines = self._active_lines(frame_width)
        current_sides = {
            line_id: _point_side(point, line, frame_width, frame_height, self.side_margin_px)
            for line_id, line in lines.items()
        }

        state = self.tracks.get(track_id)
        if state is None:
            self.tracks[track_id] = TrackState(
                point=point,
                first_seen_frame=self.frame_index,
                last_seen_frame=self.frame_index,
                first_seen_at=self.current_time,
                last_seen_at=self.current_time,
                line_sides=current_sides,
            )
            return []

        previous = state.point
        state.point = point
        state.last_seen_frame = self.frame_index
        state.last_seen_at = self.current_time
        movement_distance = _distance(previous, point)
        state.last_movement_delta = movement_distance
        crossed_lines = self._crossed_lines(
            state,
            current_sides,
            previous,
            point,
            lines,
            frame_width,
            frame_height,
        )
        if movement_distance < self.min_crossing_distance_px and not crossed_lines:
            state.last_reason = "movement_below_threshold"
            self._refresh_stable_sides(state, current_sides)
            return []

        self._refresh_stable_sides(state, current_sides)

        if self._uses_paired_lines():
            return self._count_paired_crossings(state, crossed_lines)

        directions: list[str] = []
        for crossed_line in crossed_lines:
            direction = self._direction_for_crossing(crossed_line, previous, point)
            if direction is None or direction in directions:
                continue
            directions.append(direction)

        counted: list[str] = []
        for direction in directions:
            if not self._count_direction(state, direction):
                continue
            counted.append(direction)

        return counted

    def _count_direction(self, state: TrackState, direction: str) -> bool:
        cooldown_key = direction

        if self.frame_index - state.first_seen_frame < self.min_track_age_frames:
            state.last_reason = "track_age_below_minimum"
            return False
        if (
            self.current_time is not None
            and state.first_seen_at is not None
            and self.current_time - state.first_seen_at < self.min_track_age_seconds
        ):
            state.last_reason = "track_age_below_minimum"
            return False

        if state.last_counted_direction == direction:
            state.last_reason = f"{direction}_already_counted_for_track"
            return False

        if self.current_time is not None:
            if state.cooldown_until.get(cooldown_key, -1.0) > self.current_time:
                state.last_reason = f"{direction}_cooldown_active"
                return False
        elif state.cooldowns.get(cooldown_key, -1) > self.frame_index:
            state.last_reason = f"{direction}_cooldown_active"
            return False

        state.cooldowns[cooldown_key] = self.frame_index + self.event_cooldown_frames
        if self.current_time is not None:
            state.cooldown_until[cooldown_key] = self.current_time + self.event_cooldown_seconds
        if direction == "entry":
            self.counts.entry += 1
            self.counts.occupancy += 1
        else:
            self.counts.exit += 1
            self.counts.occupancy = max(0, self.counts.occupancy - 1)
        state.last_counted_direction = direction
        state.last_reason = f"counted_{direction}"

        return True

    def remap_track(self, previous_track_id: int, target_track_id: int) -> None:
        if previous_track_id == target_track_id:
            return
        previous = self.tracks.pop(previous_track_id, None)
        if previous is None:
            return
        target = self.tracks.get(target_track_id)
        if target is None or previous.last_seen_frame > target.last_seen_frame:
            self.tracks[target_track_id] = previous
            target = previous
        target.cooldowns.update(previous.cooldowns)
        target.cooldown_until.update(previous.cooldown_until)
        if previous.pending_line is not None and (
            target.pending_started_frame is None
            or previous.pending_started_frame is None
            or previous.pending_started_frame >= target.pending_started_frame
        ):
            target.pending_line = previous.pending_line
            target.pending_started_frame = previous.pending_started_frame
            target.pending_started_at = previous.pending_started_at
        if previous.last_crossed_line is not None:
            target.last_crossed_line = previous.last_crossed_line
        if previous.last_counted_direction is not None:
            target.last_counted_direction = previous.last_counted_direction
        if previous.last_reason is not None:
            target.last_reason = previous.last_reason
        if previous.last_movement_delta is not None:
            target.last_movement_delta = previous.last_movement_delta

    def debug_state(self, track_id: int) -> dict[str, int | float | str | bool | None] | None:
        state = self.tracks.get(track_id)
        if state is None:
            return None

        time_since_first_crossing = None
        if self.current_time is not None and state.pending_started_at is not None:
            time_since_first_crossing = max(0.0, self.current_time - state.pending_started_at)

        pending_frame_gap = None
        if state.pending_started_frame is not None:
            pending_frame_gap = max(0, self.frame_index - state.pending_started_frame)

        return {
            "last_crossed_line": state.last_crossed_line,
            "pending_line": state.pending_line,
            "pending_started_frame": state.pending_started_frame,
            "pending_frame_gap": pending_frame_gap,
            "time_since_first_crossing": time_since_first_crossing,
            "last_counted_direction": state.last_counted_direction,
            "last_reason": state.last_reason,
            "last_movement_delta": state.last_movement_delta,
            "track_age_frames": max(0, self.frame_index - state.first_seen_frame),
            "track_age_seconds": (
                max(0.0, self.current_time - state.first_seen_at)
                if self.current_time is not None and state.first_seen_at is not None
                else None
            ),
            "entry_cooldown_until_frame": state.cooldowns.get("entry"),
            "exit_cooldown_until_frame": state.cooldowns.get("exit"),
            "inside_paired_sequence": state.pending_line is not None,
        }

    def _active_lines(self, frame_width: int) -> dict[str, NormalizedPath]:
        if self.entry_line is not None or self.exit_line is not None:
            lines: dict[str, NormalizedPath] = {}
            if self.entry_line is not None:
                lines["entry"] = self.entry_line
            if self.exit_line is not None:
                lines["exit"] = self.exit_line
            return lines

        position = self.line_x(frame_width) / max(frame_width, 1)
        return {"main": ((position, 0.0), (position, 1.0))}

    def _crossed_lines(
        self,
        state: TrackState,
        current_sides: dict[str, int],
        previous: Centroid,
        current: Centroid,
        lines: dict[str, NormalizedPath],
        frame_width: int,
        frame_height: int,
    ) -> list[str]:
        crossed: list[tuple[float, str]] = []
        movement_distance = _distance(previous, current)
        for line_id, current_side in current_sides.items():
            previous_side = state.line_sides.get(line_id, 0)
            movement_progress = (
                _movement_crossing_progress(
                    previous, current, lines[line_id], frame_width, frame_height
                )
                if movement_distance > self.min_crossing_distance_px
                else None
            )
            point_crossed = (
                current_side != 0 and previous_side != 0 and previous_side != current_side
            )
            line_exit_crossed = previous_side == 0 and current_side != 0
            if movement_progress is None and not point_crossed and not line_exit_crossed:
                continue

            crossed.append(
                (
                    movement_progress
                    if movement_progress is not None
                    else _crossing_progress(
                        previous, current, lines[line_id], frame_width, frame_height
                    ),
                    line_id,
                )
            )

        return [line_id for _, line_id in sorted(crossed)]

    def _direction_for_crossing(
        self, crossed_line: str | None, previous: Centroid, current: Centroid
    ) -> str | None:
        if crossed_line is None:
            return None

        if crossed_line == "main":
            direction = "entry" if current.x > previous.x else "exit"
            if self.reverse_direction:
                return "exit" if direction == "entry" else "entry"
            return direction

        return crossed_line

    def _count_paired_crossings(self, state: TrackState, crossed_lines: list[str]) -> list[str]:
        counted: list[str] = []
        for crossed_line in crossed_lines:
            direction = self._direction_for_paired_crossing(state, crossed_line)
            if direction is None or direction in counted:
                continue
            if self._count_direction(state, direction):
                counted.append(direction)
        return counted

    def _direction_for_paired_crossing(self, state: TrackState, crossed_line: str) -> str | None:
        if crossed_line not in {"entry", "exit"}:
            return None

        self._expire_pending_sequence(state)
        state.last_crossed_line = crossed_line
        first_line = state.pending_line
        if first_line is None or first_line == crossed_line:
            state.pending_line = crossed_line
            state.pending_started_frame = self.frame_index
            state.pending_started_at = self.current_time
            return None

        direction = None
        if first_line == "entry" and crossed_line == "exit":
            direction = "exit"
        elif first_line == "exit" and crossed_line == "entry":
            direction = "entry"

        state.pending_line = None
        state.pending_started_frame = None
        state.pending_started_at = None

        if direction is None:
            return None
        if self.reverse_direction:
            return "exit" if direction == "entry" else "entry"
        return direction

    def _expire_pending_sequence(self, state: TrackState) -> None:
        if state.pending_line is None:
            return

        expired_by_time = (
            self.current_time is not None
            and state.pending_started_at is not None
            and self.current_time - state.pending_started_at > self.paired_line_max_gap_seconds
        )
        expired_by_frame = (
            self.current_time is None
            and state.pending_started_frame is not None
            and self.frame_index - state.pending_started_frame > self.paired_line_max_gap_frames
        )
        if expired_by_time or expired_by_frame:
            state.pending_line = None
            state.pending_started_frame = None
            state.pending_started_at = None

    def _uses_paired_lines(self) -> bool:
        return self.entry_line is not None and self.exit_line is not None

    def _refresh_stable_sides(
        self,
        state: TrackState,
        current_sides: dict[str, int],
    ) -> None:
        for line_id, side in current_sides.items():
            if side != 0:
                state.line_sides[line_id] = side


def _point_side(
    point: Centroid, line: NormalizedPath, frame_width: int, frame_height: int, margin_px: float
) -> int:
    line_start, line_end = _nearest_scaled_segment(
        (point.x, point.y), line, frame_width, frame_height
    )
    distance = _signed_line_distance((point.x, point.y), line_start, line_end)
    if abs(distance) < margin_px:
        return 0

    return 1 if distance > 0 else -1


def _signed_line_distance(
    point: tuple[float, float], line_start: tuple[float, float], line_end: tuple[float, float]
) -> float:
    x, y = point
    x1, y1 = line_start
    x2, y2 = line_end
    dx = x2 - x1
    dy = y2 - y1
    length = hypot(dx, dy)
    if length < 1e-9:
        return 0.0

    return (dx * (y - y1) - dy * (x - x1)) / length


def _distance(first: Centroid, second: Centroid) -> float:
    return hypot(second.x - first.x, second.y - first.y)


def _crossing_progress(
    previous: Centroid, current: Centroid, line: NormalizedPath, frame_width: int, frame_height: int
) -> float:
    mid_point = ((previous.x + current.x) / 2, (previous.y + current.y) / 2)
    line_start, line_end = _nearest_scaled_segment(mid_point, line, frame_width, frame_height)
    previous_distance = _signed_line_distance((previous.x, previous.y), line_start, line_end)
    current_distance = _signed_line_distance((current.x, current.y), line_start, line_end)
    denominator = previous_distance - current_distance
    if abs(denominator) < 1e-9:
        return 1.0

    return min(1.0, max(0.0, previous_distance / denominator))


def _movement_crossing_progress(
    previous: Centroid,
    current: Centroid,
    line: NormalizedPath,
    frame_width: int,
    frame_height: int,
) -> float | None:
    start = (previous.x, previous.y)
    end = (current.x, current.y)
    scaled_points = tuple((x * frame_width, y * frame_height) for x, y in line)
    if len(scaled_points) < 2:
        return None

    crossings: list[float] = []
    for index in range(len(scaled_points) - 1):
        progress = _segment_intersection_progress(
            start, end, scaled_points[index], scaled_points[index + 1]
        )
        if progress is not None:
            crossings.append(progress)

    return min(crossings) if crossings else None


def _segment_intersection_progress(
    movement_start: tuple[float, float],
    movement_end: tuple[float, float],
    line_start: tuple[float, float],
    line_end: tuple[float, float],
) -> float | None:
    px, py = movement_start
    rx = movement_end[0] - movement_start[0]
    ry = movement_end[1] - movement_start[1]
    qx, qy = line_start
    sx = line_end[0] - line_start[0]
    sy = line_end[1] - line_start[1]
    denominator = _cross(rx, ry, sx, sy)
    qpx = qx - px
    qpy = qy - py

    if abs(denominator) < 1e-9:
        if abs(_cross(qpx, qpy, rx, ry)) >= 1e-9:
            return None
        movement_length_squared = rx * rx + ry * ry
        if movement_length_squared < 1e-9:
            return None
        start_progress = ((qx - px) * rx + (qy - py) * ry) / movement_length_squared
        end_progress = ((line_end[0] - px) * rx + (line_end[1] - py) * ry) / movement_length_squared
        overlap_start = max(0.0, min(start_progress, end_progress))
        overlap_end = min(1.0, max(start_progress, end_progress))
        if overlap_start <= overlap_end:
            return overlap_start
        return None

    t = _cross(qpx, qpy, sx, sy) / denominator
    u = _cross(qpx, qpy, rx, ry) / denominator
    tolerance = 1e-6
    if -tolerance <= t <= 1.0 + tolerance and -tolerance <= u <= 1.0 + tolerance:
        return min(1.0, max(0.0, t))
    return None


def _cross(ax: float, ay: float, bx: float, by: float) -> float:
    return ax * by - ay * bx


def _nearest_scaled_segment(
    point: tuple[float, float], line: NormalizedPath, frame_width: int, frame_height: int
) -> tuple[tuple[float, float], tuple[float, float]]:
    scaled_points = tuple((x * frame_width, y * frame_height) for x, y in line)
    if len(scaled_points) < 2:
        fallback = scaled_points[0] if scaled_points else (0.0, 0.0)
        return fallback, fallback

    closest_segment = (scaled_points[0], scaled_points[1])
    closest_distance = float("inf")
    for index in range(len(scaled_points) - 1):
        segment = (scaled_points[index], scaled_points[index + 1])
        distance = _point_segment_distance(point, segment[0], segment[1])
        if distance < closest_distance:
            closest_distance = distance
            closest_segment = segment

    return closest_segment


def _point_segment_distance(
    point: tuple[float, float], line_start: tuple[float, float], line_end: tuple[float, float]
) -> float:
    x, y = point
    x1, y1 = line_start
    x2, y2 = line_end
    dx = x2 - x1
    dy = y2 - y1
    length_squared = dx * dx + dy * dy
    if length_squared < 1e-9:
        return hypot(x - x1, y - y1)

    projection = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / length_squared))
    closest = (x1 + projection * dx, y1 + projection * dy)
    return hypot(x - closest[0], y - closest[1])
