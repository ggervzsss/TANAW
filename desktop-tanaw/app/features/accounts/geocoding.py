import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx

from app.core.config import get_settings
from app.features.accounts.options import SAN_PEDRO_ADDRESS_SUFFIX, SAN_PEDRO_BARANGAYS

SAN_PEDRO_BOUNDS = {
    "min_lat": 14.235,
    "max_lat": 14.418,
    "min_lng": 120.945,
    "max_lng": 121.131,
}
SAN_PEDRO_CENTER = {"lat": 14.3413, "lng": 121.0446}


class GeocodingError(Exception):
    pass


class GeocodingUnavailable(GeocodingError):
    pass


class GeocodingNoResult(GeocodingError):
    pass


@dataclass(frozen=True)
class GeocodeCandidate:
    latitude: float
    longitude: float
    display_address: str
    provider: str
    source: str
    confidence: float | None = None


@dataclass(frozen=True)
class ReverseGeocodeCandidate:
    latitude: float
    longitude: float
    display_address: str
    provider: str
    source: str
    confidence: float | None = None
    address: str | None = None
    barangay: str | None = None


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


async def geocode_enterprise_address(
    address: str, barangay: str, enterprise_name: str | None = None
) -> GeocodeCandidate:
    settings = get_settings()
    provider = settings.geocoder_provider.strip().lower()
    query = build_geocode_query(address, barangay, enterprise_name)

    if provider == "nominatim":
        return await geocode_with_nominatim(query, barangay)
    if provider == "geoapify":
        return await geocode_with_geoapify(query, barangay)

    raise GeocodingUnavailable(f"Unsupported geocoder provider: {settings.geocoder_provider}")


async def reverse_geocode_enterprise_location(
    latitude: float, longitude: float
) -> ReverseGeocodeCandidate:
    if not is_inside_san_pedro(latitude, longitude):
        raise GeocodingNoResult("Selected location must be inside San Pedro, Laguna.")

    settings = get_settings()
    provider = settings.geocoder_provider.strip().lower()

    if provider == "nominatim":
        return await reverse_geocode_with_nominatim(latitude, longitude)
    if provider == "geoapify":
        return await reverse_geocode_with_geoapify(latitude, longitude)

    raise GeocodingUnavailable(f"Unsupported geocoder provider: {settings.geocoder_provider}")


def build_geocode_query(address: str, barangay: str, enterprise_name: str | None = None) -> str:
    cleaned_address = address.strip().rstrip(",")
    prefix = f"{enterprise_name.strip()}, " if enterprise_name and enterprise_name.strip() else ""
    barangay_segment = f"Barangay {barangay.strip()}"

    if cleaned_address.lower().endswith(SAN_PEDRO_ADDRESS_SUFFIX.lower()):
        return f"{prefix}{cleaned_address}, {barangay_segment}, Philippines"

    return f"{prefix}{cleaned_address}, {barangay_segment}, {SAN_PEDRO_ADDRESS_SUFFIX}, Philippines"


async def geocode_with_nominatim(query: str, barangay: str) -> GeocodeCandidate:
    settings = get_settings()
    base_url = settings.geocoder_base_url or "https://nominatim.openstreetmap.org/search"
    params = {
        "q": query,
        "format": "jsonv2",
        "addressdetails": "1",
        "limit": "5",
        "countrycodes": "ph",
        "viewbox": "120.945,14.418,121.131,14.235",
        "bounded": "1",
    }
    headers = {"User-Agent": settings.geocoder_user_agent}

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(base_url, params=params, headers=headers)
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise GeocodingUnavailable("Nominatim geocoding request failed.") from exc

    candidates: list[GeocodeCandidate] = []
    for item in payload if isinstance(payload, list) else []:
        try:
            latitude = float(item["lat"])
            longitude = float(item["lon"])
        except KeyError, TypeError, ValueError:
            continue

        if not is_inside_san_pedro(latitude, longitude):
            continue

        confidence = normalize_confidence(item.get("importance"))
        candidates.append(
            GeocodeCandidate(
                latitude=latitude,
                longitude=longitude,
                display_address=str(item.get("display_name") or query),
                provider="nominatim",
                source="geocoded",
                confidence=confidence,
            ),
        )

    return select_best_candidate(candidates, barangay)


async def geocode_with_geoapify(query: str, barangay: str) -> GeocodeCandidate:
    settings = get_settings()
    if not settings.geocoder_api_key:
        raise GeocodingUnavailable("Geoapify geocoding requires GEOCODER_API_KEY.")

    base_url = settings.geocoder_base_url or "https://api.geoapify.com/v1/geocode/search"
    params = {
        "text": query,
        "filter": "rect:120.945,14.418,121.131,14.235",
        "bias": f"proximity:{SAN_PEDRO_CENTER['lng']},{SAN_PEDRO_CENTER['lat']}",
        "limit": "5",
        "apiKey": settings.geocoder_api_key,
    }

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(base_url, params=params)
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise GeocodingUnavailable("Geoapify geocoding request failed.") from exc

    candidates: list[GeocodeCandidate] = []
    for feature in payload.get("features", []) if isinstance(payload, dict) else []:
        properties = feature.get("properties", {})
        try:
            latitude = float(properties["lat"])
            longitude = float(properties["lon"])
        except KeyError, TypeError, ValueError:
            continue

        if not is_inside_san_pedro(latitude, longitude):
            continue

        rank = properties.get("rank") if isinstance(properties, dict) else {}
        confidence = (
            normalize_confidence(rank.get("confidence")) if isinstance(rank, dict) else None
        )
        candidates.append(
            GeocodeCandidate(
                latitude=latitude,
                longitude=longitude,
                display_address=str(properties.get("formatted") or query),
                provider="geoapify",
                source="geocoded",
                confidence=confidence,
            ),
        )

    return select_best_candidate(candidates, barangay)


async def reverse_geocode_with_nominatim(
    latitude: float, longitude: float
) -> ReverseGeocodeCandidate:
    settings = get_settings()
    base_url = get_nominatim_reverse_url(
        settings.geocoder_base_url or "https://nominatim.openstreetmap.org/search"
    )
    params = {
        "lat": str(latitude),
        "lon": str(longitude),
        "format": "jsonv2",
        "addressdetails": "1",
        "zoom": "18",
    }
    headers = {"User-Agent": settings.geocoder_user_agent}

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(base_url, params=params, headers=headers)
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise GeocodingUnavailable("Nominatim reverse-geocoding request failed.") from exc

    if not isinstance(payload, dict):
        raise GeocodingNoResult("No address was found for the selected San Pedro location.")

    display_address = str(payload.get("display_name") or f"{latitude:.6f}, {longitude:.6f}")
    raw_address = payload.get("address")
    address: dict[str, Any] = raw_address if isinstance(raw_address, dict) else {}
    address_line = build_address_line(address, display_address)
    barangay = extract_barangay(address, display_address)

    return ReverseGeocodeCandidate(
        latitude=latitude,
        longitude=longitude,
        display_address=display_address,
        provider="nominatim",
        source="manual",
        confidence=normalize_confidence(payload.get("importance")),
        address=address_line,
        barangay=barangay,
    )


async def reverse_geocode_with_geoapify(
    latitude: float, longitude: float
) -> ReverseGeocodeCandidate:
    settings = get_settings()
    if not settings.geocoder_api_key:
        raise GeocodingUnavailable("Geoapify reverse geocoding requires GEOCODER_API_KEY.")

    base_url = get_geoapify_reverse_url(
        settings.geocoder_base_url or "https://api.geoapify.com/v1/geocode/search"
    )
    params: dict[str, str | int | float | bool | None] = {
        "lat": latitude,
        "lon": longitude,
        "apiKey": settings.geocoder_api_key,
    }

    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(base_url, params=params)
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as exc:
        raise GeocodingUnavailable("Geoapify reverse-geocoding request failed.") from exc

    features = payload.get("features", []) if isinstance(payload, dict) else []
    feature = features[0] if features and isinstance(features[0], dict) else None
    properties = feature.get("properties", {}) if isinstance(feature, dict) else {}
    if not isinstance(properties, dict):
        raise GeocodingNoResult("No address was found for the selected San Pedro location.")

    display_address = str(properties.get("formatted") or f"{latitude:.6f}, {longitude:.6f}")
    rank = properties.get("rank") if isinstance(properties.get("rank"), dict) else {}

    return ReverseGeocodeCandidate(
        latitude=latitude,
        longitude=longitude,
        display_address=display_address,
        provider="geoapify",
        source="manual",
        confidence=normalize_confidence(rank.get("confidence") if isinstance(rank, dict) else None),
        address=build_address_line(properties, display_address),
        barangay=extract_barangay(properties, display_address),
    )


def select_best_candidate(candidates: list[GeocodeCandidate], barangay: str) -> GeocodeCandidate:
    if not candidates:
        raise GeocodingNoResult("No geocoding result was found inside San Pedro.")

    barangay_key = normalize_location_text(barangay)
    return max(
        candidates,
        key=lambda candidate: (
            barangay_key in normalize_location_text(candidate.display_address),
            candidate.confidence or 0,
        ),
    )


def normalize_confidence(value: object) -> float | None:
    if not isinstance(value, str | int | float):
        return None

    try:
        number = float(value)
    except ValueError:
        return None

    return max(0.0, min(number, 1.0))


def normalize_location_text(value: str) -> str:
    return "".join(character for character in value.lower() if character.isalnum())


def get_nominatim_reverse_url(base_url: str) -> str:
    trimmed = base_url.rstrip("/")
    if trimmed.endswith("/search"):
        return f"{trimmed[: -len('/search')]}/reverse"
    return trimmed


def get_geoapify_reverse_url(base_url: str) -> str:
    trimmed = base_url.rstrip("/")
    if trimmed.endswith("/search"):
        return f"{trimmed[: -len('/search')]}/reverse"
    return trimmed


def build_address_line(address_data: dict[str, Any], display_address: str) -> str | None:
    address_line = get_string_value(address_data, "address_line1")
    if address_line:
        return address_line

    house_number = get_string_value(address_data, "house_number") or get_string_value(
        address_data, "housenumber"
    )
    road = (
        get_string_value(address_data, "road")
        or get_string_value(address_data, "street")
        or get_string_value(address_data, "pedestrian")
    )
    if house_number and road:
        return f"{house_number} {road}"
    if road:
        return road

    area = (
        get_string_value(address_data, "neighbourhood")
        or get_string_value(address_data, "quarter")
        or get_string_value(address_data, "suburb")
        or get_string_value(address_data, "village")
        or get_string_value(address_data, "district")
    )
    if area:
        return area

    first_segment = display_address.split(",", 1)[0].strip()
    return first_segment or None


def extract_barangay(address_data: dict[str, Any], display_address: str) -> str | None:
    candidates = [
        get_string_value(address_data, "suburb"),
        get_string_value(address_data, "neighbourhood"),
        get_string_value(address_data, "quarter"),
        get_string_value(address_data, "village"),
        get_string_value(address_data, "district"),
        get_string_value(address_data, "city_district"),
        get_string_value(address_data, "hamlet"),
        display_address,
    ]

    for candidate in candidates:
        if not candidate:
            continue
        matched = match_san_pedro_barangay(candidate)
        if matched:
            return matched

    return None


def match_san_pedro_barangay(value: str) -> str | None:
    normalized = normalize_location_text(value)
    barangay_aliases = {
        "pacitai": "Pacita I",
        "pacita1": "Pacita I",
        "pacitaii": "Pacita II",
        "pacita2": "Pacita II",
        "sanlorenzo": "San Lorenzo Ruiz",
        "sanlorenzoruiz": "San Lorenzo Ruiz",
    }

    for barangay in SAN_PEDRO_BARANGAYS:
        barangay_key = normalize_location_text(barangay)
        if barangay_key and (barangay_key in normalized or normalized in barangay_key):
            return barangay

    for alias, barangay in barangay_aliases.items():
        if alias in normalized:
            return barangay

    return None


def get_string_value(data: dict[str, Any], key: str) -> str | None:
    value = data.get(key)
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    if isinstance(value, int | float):
        return str(value)
    return None


@lru_cache(maxsize=1)
def load_san_pedro_boundary() -> dict[str, Any] | None:
    # Uses the existing TANAW Leaflet GeoJSON boundary asset; see that file's metadata for source notes and limitations.
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
