from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

from app.camera.auth import redact_stream_credentials


def scrub_session_snapshot(payload: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    scrubbed = {**payload}
    changed = False
    raw_config = payload.get("camera_config")
    if isinstance(raw_config, dict):
        camera_config, config_changed = scrub_camera_config(raw_config)
        scrubbed["camera_config"] = camera_config
        changed = config_changed

    for key in ("error",):
        value = scrubbed.get(key)
        if isinstance(value, str):
            redacted = redact_stream_credentials(value)
            if redacted != value:
                scrubbed[key] = redacted
                changed = True

    raw_counts = scrubbed.get("counts")
    if isinstance(raw_counts, dict):
        counts = {**raw_counts}
        error = counts.get("error")
        if isinstance(error, str):
            redacted = redact_stream_credentials(error)
            if redacted != error:
                counts["error"] = redacted
                changed = True
        scrubbed["counts"] = counts
    return scrubbed, changed


def scrub_camera_config(config: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    scrubbed = {**config}
    username = scrubbed.get("username")
    password = scrubbed.get("password")
    has_username = isinstance(username, str) and bool(username.strip())
    has_password = isinstance(password, str) and bool(password)

    stream_url = scrubbed.get("stream_url")
    redacted_url = (
        redact_stream_credentials(stream_url) if isinstance(stream_url, str) else stream_url
    )
    url_has_credentials = (
        _stream_url_has_credentials(stream_url) if isinstance(stream_url, str) else False
    )

    scrubbed["username"] = None
    scrubbed["username_redacted"] = bool(scrubbed.get("username_redacted") or has_username)
    scrubbed["password"] = None
    scrubbed["password_redacted"] = bool(scrubbed.get("password_redacted") or has_password)
    if isinstance(stream_url, str):
        scrubbed["stream_url"] = redacted_url
    scrubbed["stream_url_credentials_redacted"] = bool(
        scrubbed.get("stream_url_credentials_redacted") or url_has_credentials
    )
    changed = has_username or has_password or url_has_credentials or scrubbed != config
    return scrubbed, changed


def persisted_camera_config_has_credentials(config: dict[str, Any]) -> bool:
    username = config.get("username")
    password = config.get("password")
    stream_url = config.get("stream_url")
    return (
        isinstance(username, str)
        and bool(username.strip())
        or isinstance(password, str)
        and bool(password)
        or isinstance(stream_url, str)
        and _stream_url_has_credentials(stream_url)
    )


def _stream_url_has_credentials(stream_url: str) -> bool:
    try:
        parsed = urlsplit(stream_url.strip())
    except ValueError:
        return "@" in stream_url
    return parsed.username is not None or parsed.password is not None or "@" in parsed.netloc
