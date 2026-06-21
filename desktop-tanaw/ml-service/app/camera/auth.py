import re
from urllib.parse import quote, urlsplit, urlunsplit

_STREAM_CREDENTIAL_PATTERN = re.compile(
    r"((?:rtsp|http|https)://)([^/\s@]+(?::[^/\s@]*)?@)", re.IGNORECASE
)


def build_authenticated_stream_url(
    stream_url: str, username: str | None = None, password: str | None = None
) -> str:
    normalized_url = stream_url.strip()
    normalized_username = username.strip() if username else ""
    if not normalized_username:
        return normalized_url

    parsed = urlsplit(normalized_url)
    if parsed.scheme.lower() != "rtsp" or not parsed.hostname:
        return normalized_url

    host = parsed.hostname
    host_part = f"[{host}]" if ":" in host and not host.startswith("[") else host
    port_part = f":{parsed.port}" if parsed.port is not None else ""
    user_part = quote(normalized_username, safe="")
    password_part = f":{quote(password, safe='')}" if password is not None else ""
    netloc = f"{user_part}{password_part}@{host_part}{port_part}"

    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, parsed.fragment))


def redact_stream_credentials(message: str) -> str:
    return _STREAM_CREDENTIAL_PATTERN.sub(r"\1***:***@", message)
