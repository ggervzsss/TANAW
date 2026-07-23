import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

SAN_PEDRO_BOUNDS = {
    "min_lat": 14.235,
    "max_lat": 14.418,
    "min_lng": 120.945,
    "max_lng": 121.131,
}


def is_inside_san_pedro(latitude: float, longitude: float) -> bool:
    if not (
        SAN_PEDRO_BOUNDS["min_lat"] <= latitude <= SAN_PEDRO_BOUNDS["max_lat"]
        and SAN_PEDRO_BOUNDS["min_lng"] <= longitude <= SAN_PEDRO_BOUNDS["max_lng"]
    ):
        return False

    boundary = load_san_pedro_boundary()
    if boundary is None:
        return True

    return any(
        feature_contains_point(feature, latitude, longitude)
        for feature in boundary.get("features", [])
        if isinstance(feature, dict)
    )


def barangay_for_location(latitude: float, longitude: float) -> str | None:
    matches = barangays_for_location(latitude, longitude)
    return matches[0] if matches else None


def barangays_for_location(latitude: float, longitude: float) -> list[str]:
    boundary = load_san_pedro_boundary()
    if boundary is None:
        return []

    matches: list[str] = []
    for feature in boundary.get("features", []):
        if not isinstance(feature, dict) or not feature_contains_point(
            feature, latitude, longitude
        ):
            continue
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            continue
        for key in ("display_name", "name", "official_barangay", "alt_name"):
            value = properties.get(key)
            if isinstance(value, str) and value.strip():
                matches.append(" ".join(value.strip().split()))
                break
    return matches


def barangay_matches_location(barangay: str, latitude: float, longitude: float) -> bool:
    detected = barangays_for_location(latitude, longitude)
    return not detected or normalize_barangay(barangay) in {
        normalize_barangay(item) for item in detected
    }


def normalize_barangay(value: str) -> str:
    return " ".join(value.casefold().strip().split())


@lru_cache(maxsize=1)
def load_san_pedro_boundary() -> dict[str, Any] | None:
    configured_path = os.environ.get("SAN_PEDRO_GEOJSON_PATH")
    candidates = [Path(configured_path)] if configured_path else []
    candidates.append(
        Path(__file__).resolve().parents[4]
        / "frontend-tanaw"
        / "public"
        / "data"
        / "san_pedro_barangays_clean_v4.geojson"
    )

    for path in candidates:
        try:
            if not path.exists():
                continue
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except OSError, json.JSONDecodeError:
            continue

        if isinstance(payload, dict) and isinstance(payload.get("features"), list):
            return payload

    return None


def feature_contains_point(feature: dict[str, Any], latitude: float, longitude: float) -> bool:
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict):
        return False

    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    point = (longitude, latitude)

    if geometry_type == "Polygon" and isinstance(coordinates, list):
        return polygon_contains_point(coordinates, point)
    if geometry_type == "MultiPolygon" and isinstance(coordinates, list):
        return any(
            polygon_contains_point(polygon, point)
            for polygon in coordinates
            if isinstance(polygon, list)
        )

    return False


def polygon_contains_point(polygon: list[Any], point: tuple[float, float]) -> bool:
    if not polygon:
        return False

    outer_ring = polygon[0]
    if not isinstance(outer_ring, list) or not point_in_ring(point, outer_ring):
        return False

    return not any(isinstance(hole, list) and point_in_ring(point, hole) for hole in polygon[1:])


def point_in_ring(point: tuple[float, float], ring: list[Any]) -> bool:
    point_lng, point_lat = point
    inside = False
    previous_index = len(ring) - 1

    for index, current in enumerate(ring):
        previous = ring[previous_index]
        previous_index = index

        if not is_position(current) or not is_position(previous):
            continue

        current_lng, current_lat = float(current[0]), float(current[1])
        previous_lng, previous_lat = float(previous[0]), float(previous[1])
        crosses_latitude = (current_lat > point_lat) != (previous_lat > point_lat)
        intersection_lng = ((previous_lng - current_lng) * (point_lat - current_lat)) / (
            previous_lat - current_lat or 1e-12
        ) + current_lng

        if crosses_latitude and point_lng < intersection_lng:
            inside = not inside

    return inside


def is_position(value: Any) -> bool:
    return (
        isinstance(value, list | tuple)
        and len(value) >= 2
        and isinstance(value[0], int | float)
        and isinstance(value[1], int | float)
    )
