"""Explain why an RTSP stream would not open.

OpenCV reports only that a stream failed to open. When it does, TANAW asks the camera
directly with an RTSP ``DESCRIBE`` request, so the user can be told whether the camera
was unreachable, refused the username and password, or has no stream at that address.
"""

import base64
import hashlib
import secrets
import socket
from typing import Literal
from urllib.parse import unquote, urlsplit, urlunsplit

ConnectionFailureReason = Literal["unreachable", "auth_failed", "stream_not_found", "unknown"]

DEFAULT_RTSP_PORT = 554
DIAGNOSIS_TIMEOUT_SECONDS = 3.0
_MAX_RESPONSE_BYTES = 16_384

FAILURE_MESSAGES: dict[ConnectionFailureReason, str] = {
    "unreachable": (
        "The camera could not be reached at this address. "
        "Check the address and that the camera is on the same network."
    ),
    "auth_failed": "The camera refused this username or password.",
    "stream_not_found": (
        "The camera answered, but no video stream was found at this address. "
        "Check the camera brand or stream address."
    ),
    "unknown": "The camera could not be reached. Check its IP address, username, and password.",
}


def diagnose_rtsp(
    stream_url: str, timeout: float = DIAGNOSIS_TIMEOUT_SECONDS
) -> ConnectionFailureReason:
    """Classify why a stream failed to open; credentials are read from the URL."""
    parsed = urlsplit(stream_url.strip())
    if parsed.scheme.lower() != "rtsp" or not parsed.hostname:
        return "unknown"
    try:
        port = parsed.port or DEFAULT_RTSP_PORT
    except ValueError:
        return "unknown"
    host = parsed.hostname
    username = unquote(parsed.username) if parsed.username else None
    password = unquote(parsed.password) if parsed.password else ""
    netloc = f"[{host}]" if ":" in host else host
    if parsed.port is not None:
        netloc = f"{netloc}:{parsed.port}"
    uri = urlunsplit((parsed.scheme, netloc, parsed.path or "/", parsed.query, ""))

    try:
        status, headers = _describe(host, port, uri, None, timeout, cseq=1)
    except _Unreachable:
        return "unreachable"
    except OSError:
        return "unknown"
    if status == 401:
        challenge = headers.get("www-authenticate", [])
        if not username or not challenge:
            return "auth_failed"
        authorization = _authorization(challenge, username, password, uri)
        if authorization is None:
            return "unknown"
        try:
            status, _ = _describe(host, port, uri, authorization, timeout, cseq=2)
        except OSError:
            return "unknown"
    return _reason_for_status(status)


def _reason_for_status(status: int) -> ConnectionFailureReason:
    if status in (401, 403):
        return "auth_failed"
    if status == 404:
        return "stream_not_found"
    return "unknown"


class _Unreachable(OSError):
    """No connection could be made to the camera's RTSP port."""


def _describe(
    host: str, port: int, uri: str, authorization: str | None, timeout: float, *, cseq: int
) -> tuple[int, dict[str, list[str]]]:
    try:
        connection = socket.create_connection((host, port), timeout=timeout)
    except OSError as exc:
        raise _Unreachable(str(exc)) from exc
    with connection:
        lines = [
            f"DESCRIBE {uri} RTSP/1.0",
            f"CSeq: {cseq}",
            "Accept: application/sdp",
            "User-Agent: TANAW",
        ]
        if authorization:
            lines.append(f"Authorization: {authorization}")
        connection.sendall(("\r\n".join(lines) + "\r\n\r\n").encode("utf-8"))
        return _read_response(connection)


def _read_response(connection: socket.socket) -> tuple[int, dict[str, list[str]]]:
    data = b""
    while b"\r\n\r\n" not in data and len(data) < _MAX_RESPONSE_BYTES:
        chunk = connection.recv(4096)
        if not chunk:
            break
        data += chunk
    head = data.split(b"\r\n\r\n", 1)[0].decode("latin-1")
    status_line, *header_lines = head.split("\r\n")
    parts = status_line.split(" ", 2)
    if len(parts) < 2 or not parts[0].upper().startswith("RTSP/") or not parts[1].isdigit():
        raise OSError("The camera did not answer with RTSP.")
    headers: dict[str, list[str]] = {}
    for line in header_lines:
        name, separator, value = line.partition(":")
        if separator:
            headers.setdefault(name.strip().lower(), []).append(value.strip())
    return int(parts[1]), headers


def _authorization(challenges: list[str], username: str, password: str, uri: str) -> str | None:
    digest = next((value for value in challenges if value.lower().startswith("digest")), None)
    if digest is not None:
        return _digest_authorization(_parse_challenge(digest[6:]), username, password, uri)
    if any(value.lower().startswith("basic") for value in challenges):
        token = base64.b64encode(f"{username}:{password}".encode()).decode("ascii")
        return f"Basic {token}"
    return None


def _parse_challenge(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for part in _split_params(text):
        name, separator, value = part.partition("=")
        if separator:
            values[name.strip().lower()] = value.strip().strip('"')
    return values


def _split_params(text: str) -> list[str]:
    parts: list[str] = []
    current = ""
    quoted = False
    for character in text:
        if character == '"':
            quoted = not quoted
        if character == "," and not quoted:
            parts.append(current)
            current = ""
        else:
            current += character
    parts.append(current)
    return parts


def _digest_authorization(
    challenge: dict[str, str], username: str, password: str, uri: str
) -> str | None:
    realm = challenge.get("realm")
    nonce = challenge.get("nonce")
    if realm is None or nonce is None:
        return None
    ha1 = _md5(f"{username}:{realm}:{password}")
    ha2 = _md5(f"DESCRIBE:{uri}")
    fields = [
        f'username="{username}"',
        f'realm="{realm}"',
        f'nonce="{nonce}"',
        f'uri="{uri}"',
    ]
    qop_options = [value.strip() for value in challenge.get("qop", "").split(",")]
    if "auth" in qop_options:
        cnonce = secrets.token_hex(8)
        response = _md5(f"{ha1}:{nonce}:00000001:{cnonce}:auth:{ha2}")
        fields += ["qop=auth", "nc=00000001", f'cnonce="{cnonce}"']
    else:
        response = _md5(f"{ha1}:{nonce}:{ha2}")
    fields.append(f'response="{response}"')
    if "opaque" in challenge:
        fields.append(f'opaque="{challenge["opaque"]}"')
    return "Digest " + ", ".join(fields)


def _md5(value: str) -> str:
    return hashlib.md5(value.encode("utf-8"), usedforsecurity=False).hexdigest()
