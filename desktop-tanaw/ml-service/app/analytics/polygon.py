"""Polygon geometry without detector, camera, or storage dependencies."""

from math import hypot, isfinite

Point = tuple[float, float]


def cross(a: Point, b: Point, c: Point) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def distance(point: Point, a: Point, b: Point) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    scale = dx * dx + dy * dy
    t = (
        max(0.0, min(1.0, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / scale))
        if scale
        else 0.0
    )
    return hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy)


def validate_polygon(points: list[Point]) -> list[Point]:
    if not 3 <= len(points) <= 12:
        raise ValueError("Draw a monitored zone with 3 to 12 vertices.")
    if any(not isfinite(v) or not 0 <= v <= 1 for point in points for v in point):
        raise ValueError("Zone coordinates must be finite and between zero and one.")
    edges = list(zip(points, points[1:] + points[:1], strict=True))
    if any(hypot(a[0] - b[0], a[1] - b[1]) < 0.005 for a, b in edges):
        raise ValueError("Zone vertices must be distinct and edges must have visible length.")
    for i, (a, b) in enumerate(edges):
        for j, (c, d) in enumerate(edges):
            if j <= i or j == i + 1 or (i == 0 and j == len(edges) - 1):
                continue
            if (
                cross(a, b, c) * cross(a, b, d) <= 0
                and cross(c, d, a) * cross(c, d, b) <= 0
                and max(min(a[0], b[0]), min(c[0], d[0])) <= min(max(a[0], b[0]), max(c[0], d[0]))
                and max(min(a[1], b[1]), min(c[1], d[1])) <= min(max(a[1], b[1]), max(c[1], d[1]))
            ):
                raise ValueError("Zone edges must not intersect.")
    area = sum(a[0] * b[1] - b[0] * a[1] for a, b in edges)
    if abs(area) < 0.005:
        raise ValueError("Draw a larger monitored zone.")
    ordered = points if area > 0 else list(reversed(points))
    start = min(range(len(ordered)), key=lambda index: ordered[index])
    return ordered[start:] + ordered[:start]


def location(point: Point, polygon: list[Point], tolerance: float = 0.0) -> int:
    """Return inside=1, boundary band=0, outside=-1."""
    inside = False
    for a, b in zip(polygon, polygon[1:] + polygon[:1], strict=True):
        if distance(point, a, b) <= tolerance:
            return 0
        if (a[1] > point[1]) != (b[1] > point[1]):
            x = a[0] + (point[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
            if point[0] < x:
                inside = not inside
    return 1 if inside else -1
