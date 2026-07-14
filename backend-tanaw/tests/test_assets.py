import asyncio
import base64
import runpy
from pathlib import Path

import pytest

from app.features.accounts.models import Account
from app.features.assets.models import AccountAsset, SupportAttachment
from app.features.assets.storage import (
    AssetStorageConflict,
    AssetStorageError,
    AssetValidationError,
    LocalAssetStorage,
    inline_content_disposition,
    validate_image,
    verify_stored_image,
)
from app.features.operational.models import SupportTicket
from app.main import app

PNG_BYTES = b"\x89PNG\r\n\x1a\nnormalized-asset-test"


@pytest.mark.asyncio
async def test_local_asset_storage_is_bounded_immutable_and_path_safe(tmp_path: Path) -> None:
    storage = LocalAssetStorage(tmp_path)
    await storage.put(key="accounts/account-1/profile/asset-1", content=PNG_BYTES, max_bytes=64)

    assert await storage.read(key="accounts/account-1/profile/asset-1", max_bytes=64) == PNG_BYTES
    await storage.put(key="accounts/account-1/profile/asset-1", content=PNG_BYTES, max_bytes=64)
    with pytest.raises(AssetStorageConflict):
        await storage.put(
            key="accounts/account-1/profile/asset-1",
            content=PNG_BYTES + b"changed",
            max_bytes=64,
        )
    with pytest.raises(AssetStorageError):
        await storage.put(key="../escape", content=PNG_BYTES, max_bytes=64)
    with pytest.raises(AssetStorageError):
        await storage.read(key="accounts/account-1/profile/asset-1", max_bytes=4)


@pytest.mark.asyncio
async def test_local_asset_storage_rejects_symlink_escape(tmp_path: Path) -> None:
    outside = tmp_path.parent / f"{tmp_path.name}-outside"
    outside.mkdir()
    (tmp_path / "accounts").symlink_to(outside, target_is_directory=True)
    storage = LocalAssetStorage(tmp_path)

    with pytest.raises(AssetStorageError, match="escapes|symbolic link"):
        await storage.put(key="accounts/account-1/asset", content=PNG_BYTES, max_bytes=64)


def test_image_validation_requires_matching_mime_extension_signature_and_size() -> None:
    image = validate_image(
        file_name="profile.png",
        declared_mime_type="image/png",
        content=PNG_BYTES,
        max_bytes=64,
    )
    verify_stored_image(
        content=image.content,
        size_bytes=image.size_bytes,
        content_hash=image.content_hash,
    )

    for file_name, mime_type, content, maximum in (
        ("profile.jpg", "image/png", PNG_BYTES, 64),
        ("profile.png", "image/jpeg", PNG_BYTES, 64),
        ("profile.png", "image/png", PNG_BYTES, 4),
    ):
        with pytest.raises(AssetValidationError):
            validate_image(
                file_name=file_name,
                declared_mime_type=mime_type,
                content=content,
                max_bytes=maximum,
            )

    with pytest.raises(AssetStorageError, match="hash"):
        verify_stored_image(
            content=image.content,
            size_bytes=image.size_bytes,
            content_hash="sha256:" + "0" * 64,
        )

    disposition = inline_content_disposition('profile "official".png')
    assert disposition.startswith("inline; filename=\"asset.png\"; filename*=UTF-8''")
    assert '"official"' not in disposition


def test_asset_cutover_is_irreversible_fail_closed_and_removes_blob_columns() -> None:
    path = (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "20260714_0031_normalize_assets_and_preferences.py"
    )
    migration = runpy.run_path(str(path))
    source = path.read_text()

    assert migration["revision"] == "20260714_0031"
    assert migration["down_revision"] == "20260714_0030"
    assert 'op.drop_column("accounts", "preferences_json")' in source
    assert 'op.drop_column("support_tickets", "attachments_json")' in source
    assert "preferences_json" not in Account.__table__.c
    assert "attachments_json" not in SupportTicket.__table__.c
    assert "storage_key" in AccountAsset.__table__.c
    assert "storage_key" in SupportAttachment.__table__.c

    encoded = base64.b64encode(PNG_BYTES).decode("ascii")
    image = migration["_decode_image"](
        f"data:image/png;base64,{encoded}",
        max_bytes=64,
    )
    assert image.content == PNG_BYTES
    assert migration["_ALLOWED_PREFERENCE_KEYS"] == {
        "theme",
        "displayImageDataUrl",
        "pendingContactNumberChange",
    }
    with pytest.raises(RuntimeError, match="backup"):
        migration["downgrade"]()


def test_target_asset_routes_use_ids_and_multipart_uploads_only() -> None:
    paths = app.openapi()["paths"]

    assert "/auth/profile/image" in paths
    assert "/auth/profile/display-image" not in paths
    assert "/operational/tickets/{ticket_id}/attachments/{attachment_id}" in paths
    assert not any("attachment_index" in path for path in paths)
    ticket_upload = paths["/operational/tickets"]["post"]["requestBody"]["content"]
    profile_upload = paths["/auth/profile/image"]["put"]["requestBody"]["content"]
    assert set(ticket_upload) == {"multipart/form-data"}
    assert set(profile_upload) == {"multipart/form-data"}


@pytest.mark.asyncio
async def test_concurrent_storage_writes_never_publish_partial_content(
    tmp_path: Path,
) -> None:
    storage = LocalAssetStorage(tmp_path)

    async def write(content: bytes) -> object:
        try:
            await storage.put(key="tickets/ticket-1/asset-1", content=content, max_bytes=64)
            return content
        except AssetStorageConflict as exc:
            return exc

    first, second = await asyncio.gather(write(PNG_BYTES), write(PNG_BYTES + b"other"))
    outcomes = (first, second)
    assert sum(isinstance(outcome, AssetStorageConflict) for outcome in outcomes) == 1
    stored = await storage.read(key="tickets/ticket-1/asset-1", max_bytes=64)
    assert stored in {PNG_BYTES, PNG_BYTES + b"other"}
