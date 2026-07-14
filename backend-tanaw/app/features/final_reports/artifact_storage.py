"""Bounded, path-safe storage for immutable final-report artifacts."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Protocol
from uuid import uuid4

PDF_MIME_TYPE = "application/pdf"
_KEY_PART = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
_METADATA_VERSION = 1
_MAX_METADATA_BYTES = 4096


class ArtifactStorageError(RuntimeError):
    """A stored artifact could not be safely written or read."""


class ArtifactStorageNotFound(ArtifactStorageError):
    """The requested object or its integrity metadata does not exist."""


class ArtifactStorageConflict(ArtifactStorageError):
    """A deterministic key already contains different immutable bytes."""


class ArtifactStorageIntegrityError(ArtifactStorageError):
    """Stored bytes do not match their persisted integrity metadata."""


@dataclass(frozen=True, slots=True)
class StoredArtifact:
    key: str
    mime_type: str
    content: bytes
    size_bytes: int
    content_hash: str


class ArtifactStorage(Protocol):
    async def put(self, *, key: str, mime_type: str, content: bytes) -> StoredArtifact: ...

    async def read(self, *, key: str) -> StoredArtifact: ...


class LocalArtifactStorage:
    """Store PDF bytes and a hash sidecar beneath one configured root.

    Writes are atomic and idempotent. Existing content is never overwritten with
    different bytes, which makes a database retry safe after a process crash.
    """

    def __init__(self, root: Path, *, max_bytes: int) -> None:
        if max_bytes <= 0:
            raise ValueError("Artifact maximum size must be positive.")
        self._root = root.expanduser().resolve()
        self._max_bytes = max_bytes
        self._root.mkdir(parents=True, exist_ok=True)

    @property
    def root(self) -> Path:
        return self._root

    async def put(self, *, key: str, mime_type: str, content: bytes) -> StoredArtifact:
        _validate_pdf(content, mime_type=mime_type, max_bytes=self._max_bytes)
        path = self._resolve_key(key)
        content_hash = _sha256(content)
        metadata = _metadata_bytes(
            mime_type=mime_type,
            size_bytes=len(content),
            content_hash=content_hash,
        )
        await asyncio.to_thread(self._put_sync, path, content, metadata)
        stored = await self.read(key=key)
        if (
            stored.mime_type != mime_type
            or stored.size_bytes != len(content)
            or stored.content_hash != content_hash
        ):
            raise ArtifactStorageIntegrityError("Stored artifact verification failed after write.")
        return stored

    async def read(self, *, key: str) -> StoredArtifact:
        path = self._resolve_key(key)
        content, metadata = await asyncio.to_thread(self._read_sync, path)
        mime_type = metadata.get("mimeType")
        size_bytes = metadata.get("sizeBytes")
        content_hash = metadata.get("contentHash")
        if (
            metadata.get("version") != _METADATA_VERSION
            or not isinstance(mime_type, str)
            or not isinstance(size_bytes, int)
            or not isinstance(content_hash, str)
        ):
            raise ArtifactStorageIntegrityError("Artifact integrity metadata is invalid.")
        _validate_pdf(content, mime_type=mime_type, max_bytes=self._max_bytes)
        if size_bytes != len(content) or content_hash != _sha256(content):
            raise ArtifactStorageIntegrityError("Artifact bytes failed size or SHA-256 validation.")
        return StoredArtifact(
            key=key,
            mime_type=mime_type,
            content=content,
            size_bytes=size_bytes,
            content_hash=content_hash,
        )

    def _resolve_key(self, key: str) -> Path:
        if not key or "\\" in key:
            raise ArtifactStorageError("Artifact storage key is invalid.")
        pure_key = PurePosixPath(key)
        if pure_key.is_absolute() or any(
            part in {"", ".", ".."} or _KEY_PART.fullmatch(part) is None for part in pure_key.parts
        ):
            raise ArtifactStorageError("Artifact storage key is invalid.")
        path = self._root.joinpath(*pure_key.parts)
        resolved_parent = path.parent.resolve()
        if resolved_parent != self._root and self._root not in resolved_parent.parents:
            raise ArtifactStorageError("Artifact storage key escapes the configured root.")
        return path

    def _put_sync(self, path: Path, content: bytes, metadata: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._assert_no_symlink_path(path)
        metadata_path = _metadata_path(path)
        if path.exists() and _read_bounded(path, self._max_bytes) != content:
            raise ArtifactStorageConflict("Artifact key already contains different bytes.")
        if metadata_path.exists() and _read_bounded(metadata_path, _MAX_METADATA_BYTES) != metadata:
            raise ArtifactStorageConflict("Artifact key has conflicting integrity metadata.")
        if not path.exists():
            _atomic_write(path, content)
        if not metadata_path.exists():
            _atomic_write(metadata_path, metadata)

    def _read_sync(self, path: Path) -> tuple[bytes, dict[str, object]]:
        self._assert_no_symlink_path(path)
        metadata_path = _metadata_path(path)
        if not path.is_file() or not metadata_path.is_file():
            raise ArtifactStorageNotFound("Artifact object is unavailable.")
        content = _read_bounded(path, self._max_bytes)
        raw_metadata = _read_bounded(metadata_path, _MAX_METADATA_BYTES)
        try:
            parsed = json.loads(raw_metadata)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ArtifactStorageIntegrityError(
                "Artifact integrity metadata is unreadable."
            ) from exc
        if not isinstance(parsed, dict):
            raise ArtifactStorageIntegrityError("Artifact integrity metadata is invalid.")
        return content, parsed

    def _assert_no_symlink_path(self, path: Path) -> None:
        current = self._root
        for part in path.relative_to(self._root).parts:
            current = current / part
            if current.exists() and current.is_symlink():
                raise ArtifactStorageError("Artifact storage path contains a symbolic link.")


def _validate_pdf(content: bytes, *, mime_type: str, max_bytes: int) -> None:
    if mime_type != PDF_MIME_TYPE:
        raise ArtifactStorageIntegrityError("Only application/pdf artifacts are supported.")
    if not content or len(content) > max_bytes:
        raise ArtifactStorageIntegrityError(
            "Artifact size is empty or exceeds the configured limit."
        )
    if not content.startswith(b"%PDF-") or not content.rstrip().endswith(b"%%EOF"):
        raise ArtifactStorageIntegrityError("Artifact bytes are not a complete PDF document.")


def _metadata_bytes(*, mime_type: str, size_bytes: int, content_hash: str) -> bytes:
    return json.dumps(
        {
            "contentHash": content_hash,
            "mimeType": mime_type,
            "sizeBytes": size_bytes,
            "version": _METADATA_VERSION,
        },
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def _metadata_path(path: Path) -> Path:
    return path.with_name(f"{path.name}.integrity.json")


def _atomic_write(path: Path, content: bytes) -> None:
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    try:
        with temporary.open("xb") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _read_bounded(path: Path, maximum: int) -> bytes:
    try:
        size = path.stat().st_size
    except FileNotFoundError as exc:
        raise ArtifactStorageNotFound("Artifact object is unavailable.") from exc
    if size <= 0 or size > maximum:
        raise ArtifactStorageIntegrityError("Stored artifact object has an invalid size.")
    with path.open("rb") as source:
        content = source.read(maximum + 1)
    if len(content) != size or len(content) > maximum:
        raise ArtifactStorageIntegrityError("Stored artifact object changed while being read.")
    return content


def _sha256(content: bytes) -> str:
    return f"sha256:{hashlib.sha256(content).hexdigest()}"
