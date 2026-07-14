"""Normalize preferences and externalize account/support image assets.

Revision ID: 20260714_0031
Revises: 20260714_0030
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import re
from collections.abc import Sequence
from datetime import datetime
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

import sqlalchemy as sa

from alembic import op

revision: str = "20260714_0031"
down_revision: str | Sequence[str] | None = "20260714_0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DATA_URL = re.compile(r"^data:(image/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$")
_ALLOWED_PREFERENCE_KEYS = {
    "theme",
    "displayImageDataUrl",
    "pendingContactNumberChange",
}
_PROFILE_MAX_BYTES = 2 * 1024 * 1024
_SUPPORT_MAX_BYTES = 5 * 1024 * 1024


def upgrade() -> None:
    _create_target_tables()
    bind = op.get_bind()
    storage_root = Path(os.getenv("ASSET_STORAGE_ROOT", "var/assets")).expanduser().resolve()
    storage_root.mkdir(parents=True, exist_ok=True)
    _migrate_account_preferences(bind, storage_root)
    _migrate_support_attachments(bind, storage_root)
    op.drop_column("accounts", "preferences_json")
    op.drop_column("support_tickets", "attachments_json")


def _create_target_tables() -> None:
    op.execute(
        """
        CREATE TABLE account_preferences (
            account_id VARCHAR(36) PRIMARY KEY
                REFERENCES accounts(id) ON DELETE CASCADE,
            theme VARCHAR(20) NOT NULL DEFAULT 'system',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT ck_account_preferences_theme
                CHECK (theme IN ('light', 'dark', 'system'))
        )
        """
    )
    op.execute(
        """
        CREATE TABLE account_profile_change_requests (
            id UUID PRIMARY KEY,
            account_id VARCHAR(36) NOT NULL
                REFERENCES accounts(id) ON DELETE CASCADE,
            request_type VARCHAR(30) NOT NULL,
            requested_value VARCHAR(255) NOT NULL,
            status VARCHAR(30) NOT NULL DEFAULT 'pending_review',
            requested_at TIMESTAMP WITH TIME ZONE NOT NULL,
            resolved_at TIMESTAMP WITH TIME ZONE,
            resolved_by_account_id VARCHAR(36)
                REFERENCES accounts(id) ON DELETE RESTRICT,
            CONSTRAINT ck_account_profile_change_requests_type
                CHECK (request_type IN ('contact_number')),
            CONSTRAINT ck_account_profile_change_requests_status
                CHECK (status IN ('pending_review', 'approved', 'rejected', 'cancelled')),
            CONSTRAINT ck_account_profile_change_requests_resolution CHECK (
                (status = 'pending_review' AND resolved_at IS NULL
                    AND resolved_by_account_id IS NULL) OR
                (status != 'pending_review' AND resolved_at IS NOT NULL)
            )
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_account_profile_change_requests_active "
        "ON account_profile_change_requests(account_id, request_type) "
        "WHERE status = 'pending_review'"
    )
    op.execute(
        "CREATE INDEX ix_account_profile_change_requests_account_status "
        "ON account_profile_change_requests(account_id, status, requested_at)"
    )
    op.execute(
        """
        CREATE TABLE account_assets (
            id UUID PRIMARY KEY,
            account_id VARCHAR(36) NOT NULL
                REFERENCES accounts(id) ON DELETE CASCADE,
            asset_kind VARCHAR(30) NOT NULL,
            storage_key VARCHAR(500) NOT NULL,
            file_name VARCHAR(160) NOT NULL,
            mime_type VARCHAR(80) NOT NULL,
            size_bytes INTEGER NOT NULL,
            content_hash VARCHAR(71) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            deleted_at TIMESTAMP WITH TIME ZONE,
            CONSTRAINT uq_account_assets_storage_key UNIQUE (storage_key),
            CONSTRAINT ck_account_assets_kind CHECK (asset_kind IN ('profile_image')),
            CONSTRAINT ck_account_assets_status CHECK (status IN ('active', 'deleted')),
            CONSTRAINT ck_account_assets_mime_type
                CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
            CONSTRAINT ck_account_assets_size CHECK (size_bytes BETWEEN 1 AND 5242880),
            CONSTRAINT ck_account_assets_content_hash
                CHECK (length(content_hash) = 71 AND content_hash LIKE 'sha256:%'),
            CONSTRAINT ck_account_assets_deletion CHECK (
                (status = 'active' AND deleted_at IS NULL) OR
                (status = 'deleted' AND deleted_at IS NOT NULL)
            )
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_account_assets_active_kind "
        "ON account_assets(account_id, asset_kind) WHERE status = 'active'"
    )
    op.execute(
        "CREATE INDEX ix_account_assets_account_status "
        "ON account_assets(account_id, status, created_at)"
    )
    op.execute(
        """
        CREATE TABLE support_attachments (
            id UUID PRIMARY KEY,
            ticket_id VARCHAR(36) NOT NULL
                REFERENCES support_tickets(id) ON DELETE CASCADE,
            ordinal INTEGER NOT NULL,
            storage_key VARCHAR(500) NOT NULL,
            file_name VARCHAR(160) NOT NULL,
            mime_type VARCHAR(80) NOT NULL,
            size_bytes INTEGER NOT NULL,
            content_hash VARCHAR(71) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'active',
            retention_expires_at TIMESTAMP WITH TIME ZONE,
            created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            deleted_at TIMESTAMP WITH TIME ZONE,
            CONSTRAINT uq_support_attachments_storage_key UNIQUE (storage_key),
            CONSTRAINT ck_support_attachments_ordinal CHECK (ordinal BETWEEN 0 AND 4),
            CONSTRAINT ck_support_attachments_status CHECK (status IN ('active', 'deleted')),
            CONSTRAINT ck_support_attachments_mime_type
                CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
            CONSTRAINT ck_support_attachments_size CHECK (size_bytes BETWEEN 1 AND 5242880),
            CONSTRAINT ck_support_attachments_content_hash
                CHECK (length(content_hash) = 71 AND content_hash LIKE 'sha256:%'),
            CONSTRAINT ck_support_attachments_deletion CHECK (
                (status = 'active' AND deleted_at IS NULL) OR
                (status = 'deleted' AND deleted_at IS NOT NULL)
            ),
            CONSTRAINT ck_support_attachments_retention CHECK (
                retention_expires_at IS NULL OR retention_expires_at > created_at
            )
        )
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX uq_support_attachments_active_ordinal "
        "ON support_attachments(ticket_id, ordinal) WHERE status = 'active'"
    )
    op.execute(
        "CREATE INDEX ix_support_attachments_ticket_status "
        "ON support_attachments(ticket_id, status, ordinal)"
    )
    op.execute(
        "CREATE INDEX ix_support_attachments_retention ON support_attachments(retention_expires_at)"
    )


def _migrate_account_preferences(bind: sa.Connection, root: Path) -> None:
    rows = bind.execute(
        sa.text("SELECT id, preferences_json FROM accounts WHERE preferences_json IS NOT NULL")
    ).mappings()
    for row in rows:
        account_id = str(row["id"])
        preferences = _json_object(row["preferences_json"], context=f"account {account_id}")
        unknown = set(preferences) - _ALLOWED_PREFERENCE_KEYS
        if unknown:
            raise RuntimeError(
                f"Account {account_id} contains unsupported preference keys: {sorted(unknown)}"
            )
        theme = preferences.get("theme", "system")
        if theme not in {"light", "dark", "system"}:
            raise RuntimeError(f"Account {account_id} has an invalid theme preference.")
        bind.execute(
            sa.text(
                "INSERT INTO account_preferences(account_id, theme) VALUES (:account_id, :theme)"
            ),
            {"account_id": account_id, "theme": theme},
        )
        _migrate_contact_request(bind, account_id, preferences.get("pendingContactNumberChange"))
        raw_image = preferences.get("displayImageDataUrl")
        if raw_image is not None:
            image = _decode_image(raw_image, max_bytes=_PROFILE_MAX_BYTES)
            asset_id = str(
                uuid5(NAMESPACE_URL, f"tanaw:account-profile:{account_id}:{image.content_hash}")
            )
            storage_key = f"accounts/{account_id}/profile/{asset_id}"
            _write_immutable(root, storage_key, image.content)
            extension = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}[
                image.mime_type
            ]
            bind.execute(
                sa.text(
                    """
                    INSERT INTO account_assets(
                        id, account_id, asset_kind, storage_key, file_name,
                        mime_type, size_bytes, content_hash, status
                    ) VALUES (
                        CAST(:id AS UUID), :account_id, 'profile_image', :storage_key,
                        :file_name, :mime_type, :size_bytes, :content_hash, 'active'
                    )
                    """
                ),
                {
                    "id": asset_id,
                    "account_id": account_id,
                    "storage_key": storage_key,
                    "file_name": f"profile.{extension}",
                    "mime_type": image.mime_type,
                    "size_bytes": len(image.content),
                    "content_hash": image.content_hash,
                },
            )


def _migrate_contact_request(bind: sa.Connection, account_id: str, raw: object) -> None:
    if raw is None:
        return
    if not isinstance(raw, dict) or set(raw) - {"phone", "requestedAt"}:
        raise RuntimeError(f"Account {account_id} has an invalid pending contact request.")
    phone = raw.get("phone")
    requested_at = raw.get("requestedAt")
    if not isinstance(phone, str) or not phone or not isinstance(requested_at, str):
        raise RuntimeError(f"Account {account_id} has an incomplete pending contact request.")
    try:
        timestamp = datetime.fromisoformat(requested_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise RuntimeError(
            f"Account {account_id} has an invalid contact request timestamp."
        ) from exc
    if timestamp.tzinfo is None or timestamp.utcoffset() is None:
        raise RuntimeError(f"Account {account_id} has a naive contact request timestamp.")
    request_id = str(uuid5(NAMESPACE_URL, f"tanaw:contact-request:{account_id}:{requested_at}"))
    bind.execute(
        sa.text(
            """
            INSERT INTO account_profile_change_requests(
                id, account_id, request_type, requested_value, status, requested_at
            ) VALUES (
                CAST(:id AS UUID), :account_id, 'contact_number', :requested_value,
                'pending_review', :requested_at
            )
            """
        ),
        {
            "id": request_id,
            "account_id": account_id,
            "requested_value": phone,
            "requested_at": timestamp,
        },
    )


def _migrate_support_attachments(bind: sa.Connection, root: Path) -> None:
    rows = bind.execute(
        sa.text(
            "SELECT id, attachments_json FROM support_tickets WHERE attachments_json IS NOT NULL"
        )
    ).mappings()
    for row in rows:
        ticket_id = str(row["id"])
        attachments = _json_array(row["attachments_json"], context=f"ticket {ticket_id}")
        if len(attachments) > 5:
            raise RuntimeError(f"Ticket {ticket_id} contains more than five attachments.")
        for ordinal, raw in enumerate(attachments):
            if not isinstance(raw, dict):
                raise RuntimeError(f"Ticket {ticket_id} attachment {ordinal} is invalid.")
            required = {"fileName", "mediaType", "sizeBytes", "dataUrl"}
            if not required.issubset(raw):
                raise RuntimeError(f"Ticket {ticket_id} attachment {ordinal} is incomplete.")
            image = _decode_image(raw["dataUrl"], max_bytes=_SUPPORT_MAX_BYTES)
            if raw["mediaType"] == "image/jpg":
                raw["mediaType"] = "image/jpeg"
            if raw["mediaType"] != image.mime_type or raw["sizeBytes"] != len(image.content):
                raise RuntimeError(f"Ticket {ticket_id} attachment {ordinal} metadata disagrees.")
            file_name = _safe_file_name(raw["fileName"])
            attachment_id = str(
                uuid5(
                    NAMESPACE_URL,
                    f"tanaw:support-attachment:{ticket_id}:{ordinal}:{image.content_hash}",
                )
            )
            storage_key = f"tickets/{ticket_id}/{attachment_id}"
            _write_immutable(root, storage_key, image.content)
            bind.execute(
                sa.text(
                    """
                    INSERT INTO support_attachments(
                        id, ticket_id, ordinal, storage_key, file_name,
                        mime_type, size_bytes, content_hash, status
                    ) VALUES (
                        CAST(:id AS UUID), :ticket_id, :ordinal, :storage_key,
                        :file_name, :mime_type, :size_bytes, :content_hash, 'active'
                    )
                    """
                ),
                {
                    "id": attachment_id,
                    "ticket_id": ticket_id,
                    "ordinal": ordinal,
                    "storage_key": storage_key,
                    "file_name": file_name,
                    "mime_type": image.mime_type,
                    "size_bytes": len(image.content),
                    "content_hash": image.content_hash,
                },
            )


class _Image:
    def __init__(self, mime_type: str, content: bytes) -> None:
        self.mime_type = mime_type
        self.content = content
        self.content_hash = f"sha256:{hashlib.sha256(content).hexdigest()}"


def _decode_image(raw: object, *, max_bytes: int) -> _Image:
    if not isinstance(raw, str):
        raise RuntimeError("Legacy image payload is not a data URL.")
    match = _DATA_URL.fullmatch(raw)
    if match is None:
        raise RuntimeError("Legacy image payload is not a supported base64 image.")
    mime_type = match.group(1).replace("image/jpg", "image/jpeg")
    try:
        content = base64.b64decode(match.group(2), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise RuntimeError("Legacy image payload contains invalid base64.") from exc
    if not content or len(content) > max_bytes or _detect_mime(content) != mime_type:
        raise RuntimeError("Legacy image payload failed size or signature validation.")
    return _Image(mime_type, content)


def _detect_mime(content: bytes) -> str | None:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return None


def _safe_file_name(raw: object) -> str:
    if not isinstance(raw, str):
        raise RuntimeError("Legacy attachment file name is invalid.")
    value = raw.strip().replace("\\", "/").split("/")[-1]
    if not value or len(value) > 160 or any(char in value for char in "\r\n\0"):
        raise RuntimeError("Legacy attachment file name is invalid.")
    return value


def _write_immutable(root: Path, key: str, content: bytes) -> None:
    path = root.joinpath(*key.split("/"))
    resolved_parent = path.parent.resolve()
    if root != resolved_parent and root not in resolved_parent.parents:
        raise RuntimeError("Asset migration key escapes the configured storage root.")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != content:
            raise RuntimeError(f"Asset migration key {key} contains conflicting bytes.")
        return
    temporary = path.with_name(f".{path.name}.migration.tmp")
    try:
        with temporary.open("xb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.read_bytes() != content:
                raise RuntimeError(
                    f"Asset migration key {key} contains conflicting bytes."
                ) from None
    finally:
        temporary.unlink(missing_ok=True)


def _json_object(raw: object, *, context: str) -> dict[str, object]:
    parsed = _parse_json(raw, context=context)
    if not isinstance(parsed, dict):
        raise RuntimeError(f"Legacy JSON for {context} is not an object.")
    return parsed


def _json_array(raw: object, *, context: str) -> list[object]:
    parsed = _parse_json(raw, context=context)
    if not isinstance(parsed, list):
        raise RuntimeError(f"Legacy JSON for {context} is not an array.")
    return parsed


def _parse_json(raw: object, *, context: str) -> object:
    if not isinstance(raw, str):
        raise RuntimeError(f"Legacy JSON for {context} is not text.")
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Legacy JSON for {context} is invalid.") from exc


def downgrade() -> None:
    raise RuntimeError(
        "Revision 20260714_0031 is intentionally irreversible because source JSON/blob "
        "columns are removed after verified object extraction. Restore the external "
        "pre-cutover backup and matching application build instead."
    )
