"""Configured asset-storage dependency."""

from functools import lru_cache

from app.core.config import get_settings
from app.features.assets.storage import AssetStorage, LocalAssetStorage


@lru_cache
def get_asset_storage() -> AssetStorage:
    return LocalAssetStorage(get_settings().asset_storage_root)


def reset_asset_storage_cache() -> None:
    get_asset_storage.cache_clear()
