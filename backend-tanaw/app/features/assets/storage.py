"""Path-safe, bounded local object storage for mutable user assets."""

from __future__ import annotations

import asyncio
import hashlib
import os
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Protocol
from urllib.parse import quote
from uuid import uuid4

ALLOWED_IMAGE_MIME_TYPES = frozenset({"image/png", "image/jpeg", "image/webp"})
_KEY_PART = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


class AssetStorageError(RuntimeError):
    """An asset object could not be safely stored or read."""


class AssetStorageNotFound(AssetStorageError):
    """The requested object is unavailable."""


class AssetStorageConflict(AssetStorageError):
    """An immutable key already contains different bytes."""


class AssetValidationError(ValueError):
    """An uploaded image failed bounded MIME or signature validation."""


@dataclass(frozen=True, slots=True)
class ValidatedImage:
    file_name: str
    mime_type: str
    content: bytes
    size_bytes: int
    content_hash: str


class AssetStorage(Protocol):
    async def put(self, *, key: str, content: bytes, max_bytes: int) -> None: ...

    async def read(self, *, key: str, max_bytes: int) -> bytes: ...

    async def delete(self, *, key: str) -> None: ...


class LocalAssetStorage:
    """Write immutable objects atomically below one configured root."""

    def __init__(self, root: Path) -> None:
        self._root = root.expanduser().resolve()
        self._root.mkdir(parents=True, exist_ok=True)

    @property
    def root(self) -> Path:
        return self._root

    async def put(self, *, key: str, content: bytes, max_bytes: int) -> None:
        if not content or len(content) > max_bytes:
            raise AssetStorageError("Asset size is outside the configured limit.")
        path = self._resolve_key(key)
        await asyncio.to_thread(self._put_sync, path, content, max_bytes)

    async def read(self, *, key: str, max_bytes: int) -> bytes:
        path = self._resolve_key(key)
        return await asyncio.to_thread(self._read_sync, path, max_bytes)

    async def delete(self, *, key: str) -> None:
        path = self._resolve_key(key)
        await asyncio.to_thread(self._delete_sync, path)

    def _resolve_key(self, key: str) -> Path:
        if not key or "\\" in key:
            raise AssetStorageError("Asset storage key is invalid.")
        pure_key = PurePosixPath(key)
        if pure_key.is_absolute() or any(
            part in {"", ".", ".."} or _KEY_PART.fullmatch(part) is None for part in pure_key.parts
        ):
            raise AssetStorageError("Asset storage key is invalid.")
        path = self._root.joinpath(*pure_key.parts)
        resolved_parent = path.parent.resolve()
        if resolved_parent != self._root and self._root not in resolved_parent.parents:
            raise AssetStorageError("Asset storage key escapes the configured root.")
        return path

    def _put_sync(self, path: Path, content: bytes, max_bytes: int) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._assert_no_symlink_path(path)
        if path.exists():
            if _read_bounded(path, max_bytes) != content:
                raise AssetStorageConflict("Asset key already contains different bytes.")
            return
        temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
        try:
            with temporary.open("xb") as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
            try:
                os.link(temporary, path)
            except FileExistsError:
                if _read_bounded(path, max_bytes) != content:
                    raise AssetStorageConflict(
                        "Asset key already contains different bytes."
                    ) from None
        finally:
            temporary.unlink(missing_ok=True)

    def _read_sync(self, path: Path, max_bytes: int) -> bytes:
        self._assert_no_symlink_path(path)
        if not path.is_file():
            raise AssetStorageNotFound("Asset object is unavailable.")
        return _read_bounded(path, max_bytes)

    def _delete_sync(self, path: Path) -> None:
        self._assert_no_symlink_path(path)
        path.unlink(missing_ok=True)

    def _assert_no_symlink_path(self, path: Path) -> None:
        current = self._root
        for part in path.relative_to(self._root).parts:
            current = current / part
            if current.is_symlink():
                raise AssetStorageError("Asset storage path contains a symbolic link.")


def validate_image(
    *,
    file_name: str,
    declared_mime_type: str | None,
    content: bytes,
    max_bytes: int,
) -> ValidatedImage:
    safe_name = file_name.strip().replace("\\", "/").split("/")[-1]
    if not safe_name or len(safe_name) > 160 or any(char in safe_name for char in "\r\n\0"):
        raise AssetValidationError("Image file name is invalid.")
    mime_type = (declared_mime_type or "").strip().lower()
    if mime_type == "image/jpg":
        mime_type = "image/jpeg"
    if mime_type not in ALLOWED_IMAGE_MIME_TYPES:
        raise AssetValidationError("Only PNG, JPEG, and WebP images are allowed.")
    if not content or len(content) > max_bytes:
        raise AssetValidationError("Image size is outside the configured limit.")
    detected = _detect_image_mime_type(content)
    if detected != mime_type:
        raise AssetValidationError("Image content does not match its declared MIME type.")
    expected_extensions = {
        "image/png": (".png",),
        "image/jpeg": (".jpg", ".jpeg"),
        "image/webp": (".webp",),
    }[mime_type]
    if not safe_name.lower().endswith(expected_extensions):
        raise AssetValidationError("Image extension does not match its MIME type.")
    return ValidatedImage(
        file_name=safe_name,
        mime_type=mime_type,
        content=content,
        size_bytes=len(content),
        content_hash=f"sha256:{hashlib.sha256(content).hexdigest()}",
    )


def verify_stored_image(*, content: bytes, size_bytes: int, content_hash: str) -> None:
    if len(content) != size_bytes:
        raise AssetStorageError("Stored asset size does not match its metadata.")
    actual_hash = f"sha256:{hashlib.sha256(content).hexdigest()}"
    if actual_hash != content_hash:
        raise AssetStorageError("Stored asset hash does not match its metadata.")


def inline_content_disposition(file_name: str) -> str:
    """Return a header-safe inline filename with an RFC 5987 Unicode value."""

    suffix = Path(file_name).suffix.lower()
    fallback = f"asset{suffix}" if suffix in {".png", ".jpg", ".jpeg", ".webp"} else "asset"
    return f"inline; filename=\"{fallback}\"; filename*=UTF-8''{quote(file_name, safe='')}"


def _detect_image_mime_type(content: bytes) -> str | None:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return None


def _read_bounded(path: Path, max_bytes: int) -> bytes:
    with path.open("rb") as handle:
        content = handle.read(max_bytes + 1)
    if not content or len(content) > max_bytes:
        raise AssetStorageError("Stored asset size is outside the configured limit.")
    return content
