from dataclasses import dataclass, field
from datetime import UTC, datetime
from math import hypot

from app.counting.geometry import Centroid

NormalizedLine = tuple[tuple[float, float], tuple[float, float]]


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
    last_seen_frame: int
    last_seen_at: float | None = None
    line_sides: dict[str, int] = field(default_factory=dict)
    cooldowns: dict[str, int] = field(default_factory=dict)
    cooldown_until: dict[str, float] = field(default_factory=dict)
    counted_directions: set[str] = field(default_factory=set)
    pending_line: str | None = None
    pending_frame: int = 0
    pending_at: float | None = None


@dataclass
class TripwireCounter:
    tripwire_position: float = 0.5
    entry_line: NormalizedLine | None = None
    exit_line: NormalizedLine | None = None
    reverse_direction: bool = False
    side_margin_px: float = 6.0
    min_crossing_distance_px: float = 10.0
    event_cooldown_frames: int = 18
    paired_line_max_gap_frames: int = 90
    track_ttl_frames: int = 45
    event_cooldown_seconds: float = 3.6
    paired_line_max_gap_seconds: float = 18.0
    track_ttl_seconds: float = 9.0
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

    def update(
        self, track_id: int, point: Centroid, frame_width: int, frame_height: int
    ) -> str | None:
        lines = self._active_lines(frame_width)
        current_sides = {
            line_id: _point_side(point, line, frame_width, frame_height, self.side_margin_px)
            for line_id, line in lines.items()
        }

        state = self.tracks.get(track_id)
        if state is None:
            self.tracks[track_id] = TrackState(
                point=point,
                last_seen_frame=self.frame_index,
                last_seen_at=self.current_time,
                line_sides=current_sides,
            )
            return None

        previous = state.point
        state.point = point
        state.last_seen_frame = self.frame_index
        state.last_seen_at = self.current_time
        movement_distance = _distance(previous, point)
        if movement_distance < self.min_crossing_distance_px:
            self._refresh_stable_sides(state, current_sides)
            return None

        crossed_lines = self._crossed_lines(
            state, current_sides, previous, point, lines, frame_width, frame_height
        )
        direction = None
        for crossed_line in crossed_lines:
            direction = self._direction_for_crossing(state, crossed_line, previous, point)
            if direction is not None:
                break
        self._refresh_stable_sides(state, current_sides)

        if direction is None:
            return None

        cooldown_key = direction
        if direction in state.counted_directions:
            return None

        if self.current_time is not None:
            if state.cooldown_until.get(cooldown_key, -1.0) > self.current_time:
                return None
        elif state.cooldowns.get(cooldown_key, -1) > self.frame_index:
            return None

        state.counted_directions.add(direction)
        state.cooldowns[cooldown_key] = self.frame_index + self.event_cooldown_frames
        if self.current_time is not None:
            state.cooldown_until[cooldown_key] = self.current_time + self.event_cooldown_seconds
        if direction == "entry":
            self.counts.entry += 1
            self.counts.occupancy += 1
        else:
            self.counts.exit += 1
            self.counts.occupancy = max(0, self.counts.occupancy - 1)

        return direction

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
        target.counted_directions.update(previous.counted_directions)
        target.cooldowns.update(previous.cooldowns)
        target.cooldown_until.update(previous.cooldown_until)

    def _active_lines(self, frame_width: int) -> dict[str, NormalizedLine]:
        if self.entry_line is not None or self.exit_line is not None:
            lines: dict[str, NormalizedLine] = {}
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
        lines: dict[str, NormalizedLine],
        frame_width: int,
        frame_height: int,
    ) -> list[str]:
        crossed: list[tuple[float, str]] = []
        for line_id, current_side in current_sides.items():
            if current_side == 0:
                continue

            previous_side = state.line_sides.get(line_id, 0)
            if previous_side == 0:
                continue

            if previous_side == current_side:
                continue

            crossed.append(
                (
                    _crossing_progress(
                        previous, current, lines[line_id], frame_width, frame_height
                    ),
                    line_id,
                )
            )

        return [line_id for _, line_id in sorted(crossed)]

    def _direction_for_crossing(
        self, state: TrackState, crossed_line: str | None, previous: Centroid, current: Centroid
    ) -> str | None:
        if crossed_line is None:
            return None

        if crossed_line == "main":
            direction = "entry" if current.x > previous.x else "exit"
            if self.reverse_direction:
                return "exit" if direction == "entry" else "entry"
            return direction

        if self.entry_line is not None and self.exit_line is not None:
            return self._paired_line_direction(state, crossed_line)

        return crossed_line

    def _paired_line_direction(self, state: TrackState, crossed_line: str) -> str | None:
        expired_by_time = (
            self.current_time is not None
            and state.pending_at is not None
            and self.current_time - state.pending_at > self.paired_line_max_gap_seconds
        )
        expired_by_frame = (
            self.current_time is None
            and self.frame_index - state.pending_frame > self.paired_line_max_gap_frames
        )
        if state.pending_line is not None and (expired_by_time or expired_by_frame):
            state.pending_line = None
            state.pending_frame = 0
            state.pending_at = None

        if state.pending_line is None:
            state.pending_line = crossed_line
            state.pending_frame = self.frame_index
            state.pending_at = self.current_time
            return None

        if state.pending_line == crossed_line:
            state.pending_frame = self.frame_index
            state.pending_at = self.current_time
            return None

        direction = crossed_line
        state.pending_line = None
        state.pending_frame = 0
        state.pending_at = None
        return direction

    def _refresh_stable_sides(self, state: TrackState, current_sides: dict[str, int]) -> None:
        for line_id, side in current_sides.items():
            if side != 0:
                state.line_sides[line_id] = side


def _point_side(
    point: Centroid, line: NormalizedLine, frame_width: int, frame_height: int, margin_px: float
) -> int:
    line_start, line_end = _scale_line(line, frame_width, frame_height)
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
    previous: Centroid, current: Centroid, line: NormalizedLine, frame_width: int, frame_height: int
) -> float:
    line_start, line_end = _scale_line(line, frame_width, frame_height)
    previous_distance = _signed_line_distance((previous.x, previous.y), line_start, line_end)
    current_distance = _signed_line_distance((current.x, current.y), line_start, line_end)
    denominator = previous_distance - current_distance
    if abs(denominator) < 1e-9:
        return 1.0

    return min(1.0, max(0.0, previous_distance / denominator))


def _scale_line(
    line: NormalizedLine, frame_width: int, frame_height: int
) -> tuple[tuple[float, float], tuple[float, float]]:
    (x1, y1), (x2, y2) = line
    return (x1 * frame_width, y1 * frame_height), (x2 * frame_width, y2 * frame_height)
