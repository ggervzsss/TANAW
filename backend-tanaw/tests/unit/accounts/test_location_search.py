import httpx
import pytest

from app.features.accounts.location_search import (
    GeoapifyLocationSearchClient,
    LocationSearchError,
)


@pytest.mark.asyncio
async def test_geoapify_search_filters_and_normalizes_san_pedro_results() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "place_id": "inside-place",
                        "name": "Archie's Event Place",
                        "formatted": "Archie's Event Place, San Antonio, San Pedro, Laguna, Philippines",
                        "address_line1": "Archie's Event Place",
                        "city": "San Pedro",
                        "lat": 14.3525904,
                        "lon": 121.0314825,
                    },
                    {
                        "place_id": "irrelevant-city",
                        "name": "San Pedro",
                        "formatted": "San Pedro, Laguna, Philippines",
                        "address_line1": "San Pedro",
                        "city": "San Pedro",
                        "lat": 14.35,
                        "lon": 121.04,
                    },
                    {
                        "place_id": "outside-place",
                        "name": "Outside Venue",
                        "formatted": "Outside Venue, Biñan, Laguna, Philippines",
                        "address_line1": "Outside Venue",
                        "city": "Biñan",
                        "lat": 14.333,
                        "lon": 121.08,
                    },
                ]
            },
        )

    client = GeoapifyLocationSearchClient(
        "private-key",
        transport=httpx.MockTransport(handler),
    )
    try:
        first = await client.autocomplete("  Archie's   Event Place ")
        second = await client.autocomplete("archie's event place")
    finally:
        await client.aclose()

    assert len(requests) == 1
    assert requests[0].url.params["text"] == "Archie's Event Place, San Pedro, Laguna"
    assert requests[0].url.params["filter"].endswith("|countrycode:ph")
    assert requests[0].url.params["apiKey"] == "private-key"
    assert first == second
    assert [suggestion.model_dump() for suggestion in first] == [
        {
            "placeId": "inside-place",
            "name": "Archie's Event Place",
            "formattedAddress": "Archie's Event Place, San Antonio, San Pedro, Laguna, Philippines",
            "addressLine": "Archie's Event Place",
            "latitude": 14.3525904,
            "longitude": 121.0314825,
            "barangay": "San Antonio",
        }
    ]


@pytest.mark.asyncio
async def test_geoapify_search_converts_provider_failures_to_domain_error() -> None:
    client = GeoapifyLocationSearchClient(
        "private-key",
        transport=httpx.MockTransport(
            lambda _: httpx.Response(429, json={"message": "rate limited"})
        ),
    )
    try:
        with pytest.raises(LocationSearchError) as error:
            await client.autocomplete("Lolo Uweng Shrine")
    finally:
        await client.aclose()

    assert error.value.status_code == 429
    assert "private-key" not in str(error.value)


@pytest.mark.asyncio
async def test_geoapify_search_contextualizes_partial_queries_and_deduplicates_places() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.params["text"].startswith("lolo u"):
            return httpx.Response(200, json={"results": []})
        return httpx.Response(
            200,
            json={
                "results": [
                    {
                        "place_id": "shrine-amenity",
                        "name": "Lolo Uweng Shrine",
                        "formatted": "Lolo Uweng Shrine, Hernandez Street, San Pedro, 4023 Laguna, Philippines",
                        "address_line1": "Lolo Uweng Shrine",
                        "city": "San Pedro",
                        "suburb": "Landayan",
                        "lat": 14.3504393,
                        "lon": 121.0663555,
                    },
                    {
                        "place_id": "shrine-street",
                        "formatted": "Lolo Uweng Shrine, San Pedro, 4023 Laguna, Philippines",
                        "address_line1": "Lolo Uweng Shrine",
                        "city": "San Pedro",
                        "suburb": "Landayan",
                        "lat": 14.350428,
                        "lon": 121.066234,
                    },
                ]
            },
        )

    client = GeoapifyLocationSearchClient(
        "private-key",
        transport=httpx.MockTransport(handler),
    )
    try:
        results = await client.autocomplete("lolo uw")
    finally:
        await client.aclose()

    assert len(results) == 1
    assert results[0].name == "Lolo Uweng Shrine"
    assert results[0].barangay == "Landayan"
    assert [request.url.params["text"] for request in requests] == [
        "lolo uw, San Pedro, Laguna",
        "lolo, San Pedro, Laguna",
    ]
