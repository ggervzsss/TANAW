import re
from collections import OrderedDict
from dataclasses import dataclass
from time import monotonic
from typing import Any

import httpx

from app.features.accounts.location_validation import (
    SAN_PEDRO_BOUNDS,
    barangay_for_location,
    is_inside_san_pedro,
)
from app.features.accounts.options import SAN_PEDRO_BARANGAYS
from app.features.accounts.schemas import EnterpriseLocationSuggestion

GEOAPIFY_BASE_URL = "https://api.geoapify.com"
SAN_PEDRO_CENTER = (121.0446, 14.3413)
LOCATION_SEARCH_LIMIT = 8
CACHE_TTL_SECONDS = 300.0
MAX_CACHE_ENTRIES = 128


class LocationSearchError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class CachedSuggestions:
    expires_at: float
    suggestions: tuple[EnterpriseLocationSuggestion, ...]


class GeoapifyLocationSearchClient:
    def __init__(
        self,
        api_key: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._api_key = api_key
        self._client = httpx.AsyncClient(
            base_url=GEOAPIFY_BASE_URL,
            headers={"User-Agent": "TANAW/1.0"},
            timeout=httpx.Timeout(connect=3.0, read=6.0, write=3.0, pool=3.0),
            limits=httpx.Limits(
                max_connections=10,
                max_keepalive_connections=5,
                keepalive_expiry=30.0,
            ),
            transport=transport,
        )
        self._cache: OrderedDict[str, CachedSuggestions] = OrderedDict()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def autocomplete(self, query: str) -> list[EnterpriseLocationSuggestion]:
        normalized_query = " ".join(query.strip().split())
        cache_key = normalized_query.casefold()
        cached = self._cache.get(cache_key)
        if cached is not None and cached.expires_at > monotonic():
            self._cache.move_to_end(cache_key)
            return list(cached.suggestions)
        if cached is not None:
            self._cache.pop(cache_key, None)

        try:
            response = await self._client.get(
                "/v1/geocode/autocomplete",
                params={
                    "text": _contextualized_query(normalized_query),
                    "filter": _san_pedro_filter(),
                    "bias": f"proximity:{SAN_PEDRO_CENTER[0]},{SAN_PEDRO_CENTER[1]}",
                    "format": "json",
                    "lang": "en",
                    "limit": str(LOCATION_SEARCH_LIMIT),
                    "apiKey": self._api_key,
                },
            )
        except httpx.HTTPError as exc:
            raise LocationSearchError("The location search provider could not be reached.") from exc

        if response.is_error:
            raise LocationSearchError(
                "The location search provider rejected the request.",
                status_code=response.status_code,
            )
        try:
            payload = response.json()
        except ValueError as exc:
            raise LocationSearchError(
                "The location search provider returned invalid data."
            ) from exc

        suggestions = _parse_suggestions(payload, normalized_query)
        fallback_query = _fallback_query(normalized_query)
        if not suggestions and fallback_query is not None:
            fallback_suggestions = await self.autocomplete(fallback_query)
            suggestions = [
                suggestion
                for suggestion in fallback_suggestions
                if _matches_query(
                    normalized_query,
                    f"{suggestion.name} {suggestion.formattedAddress}",
                )
            ]
        self._cache[cache_key] = CachedSuggestions(
            expires_at=monotonic() + CACHE_TTL_SECONDS,
            suggestions=tuple(suggestions),
        )
        self._cache.move_to_end(cache_key)
        while len(self._cache) > MAX_CACHE_ENTRIES:
            self._cache.popitem(last=False)
        return suggestions


def _san_pedro_filter() -> str:
    return (
        f"rect:{SAN_PEDRO_BOUNDS['min_lng']},{SAN_PEDRO_BOUNDS['min_lat']},"
        f"{SAN_PEDRO_BOUNDS['max_lng']},{SAN_PEDRO_BOUNDS['max_lat']}|countrycode:ph"
    )


def _contextualized_query(query: str) -> str:
    if "san pedro" in query.casefold():
        return query
    return f"{query}, San Pedro, Laguna"


def _fallback_query(query: str) -> str | None:
    prefix, separator, _ = query.rpartition(" ")
    normalized_prefix = prefix.strip()
    return normalized_prefix if separator and len(normalized_prefix) >= 2 else None


def _parse_suggestions(payload: object, query: str) -> list[EnterpriseLocationSuggestion]:
    if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
        raise LocationSearchError("The location search provider returned invalid data.")

    suggestions: list[EnterpriseLocationSuggestion] = []
    seen_places: set[tuple[str, float, float]] = set()
    for item in payload["results"]:
        suggestion = _parse_suggestion(item, query)
        if suggestion is None:
            continue
        deduplication_key = (
            suggestion.name.casefold(),
            round(suggestion.latitude, 3),
            round(suggestion.longitude, 3),
        )
        if deduplication_key in seen_places:
            continue
        seen_places.add(deduplication_key)
        suggestions.append(suggestion)
    return suggestions


def _parse_suggestion(item: object, query: str) -> EnterpriseLocationSuggestion | None:
    if not isinstance(item, dict):
        return None
    latitude = _number(item.get("lat"))
    longitude = _number(item.get("lon"))
    if latitude is None or longitude is None or not is_inside_san_pedro(latitude, longitude):
        return None

    formatted_address = _text(item.get("formatted"))
    if not _is_san_pedro_result(item, formatted_address):
        return None
    name = _text(item.get("name")) or _text(item.get("address_line1")) or formatted_address
    address_line = _text(item.get("address_line1")) or name
    place_id = _text(item.get("place_id")) or f"{latitude:.7f}:{longitude:.7f}"
    if not name or not formatted_address or not address_line:
        return None
    if not _matches_query(query, f"{name} {formatted_address}"):
        return None

    return EnterpriseLocationSuggestion(
        placeId=place_id,
        name=name,
        formattedAddress=formatted_address,
        addressLine=address_line,
        latitude=latitude,
        longitude=longitude,
        barangay=barangay_for_location(latitude, longitude) or _provider_barangay(item),
    )


def _is_san_pedro_result(item: dict[str, Any], formatted_address: str) -> bool:
    administrative_values = [
        _text(item.get(field)) for field in ("city", "municipality", "county", "district")
    ]
    return any(_is_san_pedro_name(value) for value in administrative_values) or (
        "san pedro" in formatted_address.casefold() and "laguna" in formatted_address.casefold()
    )


def _is_san_pedro_name(value: str) -> bool:
    normalized = " ".join(value.casefold().replace("city of", "").split())
    return normalized == "san pedro" or normalized.startswith("san pedro,")


def _matches_query(query: str, candidate: str) -> bool:
    query_tokens = _search_tokens(query)
    candidate_tokens = _search_tokens(candidate)
    return bool(query_tokens) and all(
        any(candidate_token.startswith(query_token) for candidate_token in candidate_tokens)
        for query_token in query_tokens
    )


def _search_tokens(value: str) -> set[str]:
    normalized = re.sub(r"['’]s\b", "", value.casefold())
    return set(re.findall(r"[a-z0-9]+", normalized))


def _provider_barangay(item: dict[str, Any]) -> str | None:
    provider_names = {
        " ".join(_text(item.get(field)).casefold().split())
        for field in ("suburb", "district")
        if _text(item.get(field))
    }
    return next(
        (
            barangay
            for barangay in SAN_PEDRO_BARANGAYS
            if " ".join(barangay.casefold().split()) in provider_names
        ),
        None,
    )


def _number(value: object) -> float | None:
    if isinstance(value, int | float) and not isinstance(value, bool):
        return float(value)
    return None


def _text(value: object) -> str:
    return " ".join(value.strip().split()) if isinstance(value, str) else ""
