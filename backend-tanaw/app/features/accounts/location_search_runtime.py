from app.core.config import Settings
from app.features.accounts.location_search import GeoapifyLocationSearchClient

_location_search_client: GeoapifyLocationSearchClient | None = None


class LocationSearchNotConfiguredError(RuntimeError):
    """Raised when Geoapify location search has not been configured."""


async def initialize_location_search_runtime(settings: Settings) -> None:
    global _location_search_client
    await close_location_search_runtime()
    if settings.geoapify_api_key is None:
        return
    _location_search_client = GeoapifyLocationSearchClient(
        settings.geoapify_api_key.get_secret_value()
    )


async def close_location_search_runtime() -> None:
    global _location_search_client
    client = _location_search_client
    _location_search_client = None
    if client is not None:
        await client.aclose()


def get_location_search_client() -> GeoapifyLocationSearchClient:
    if _location_search_client is None:
        raise LocationSearchNotConfiguredError("Geoapify location search is not configured.")
    return _location_search_client
