from fastapi import Request, Response, WebSocket

LOCAL_HOSTNAMES = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "testserver"}
NO_STORE_PATH_PREFIXES = ("/auth", "/accounts", "/activity-logs", "/dev", "/operational")
HSTS_VALUE = "max-age=31536000; includeSubDomains; preload"
NO_STORE_VALUE = "no-cache, no-store, must-revalidate, private"


def apply_security_headers(request: Request, response: Response) -> None:
    remove_disclosure_headers(response)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")

    if should_prevent_cache(request):
        response.headers["Cache-Control"] = NO_STORE_VALUE
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"

    if is_https_non_local_request(request):
        response.headers.setdefault("Strict-Transport-Security", HSTS_VALUE)


def websocket_security_headers(websocket: WebSocket) -> list[tuple[bytes, bytes]]:
    headers: list[tuple[bytes, bytes]] = [
        (b"x-content-type-options", b"nosniff"),
        (b"x-frame-options", b"DENY"),
        (b"referrer-policy", b"strict-origin-when-cross-origin"),
        (b"cache-control", NO_STORE_VALUE.encode()),
        (b"pragma", b"no-cache"),
        (b"expires", b"0"),
    ]
    if is_secure_non_local_websocket(websocket):
        headers.append((b"strict-transport-security", HSTS_VALUE.encode()))
    return headers


def remove_disclosure_headers(response: Response) -> None:
    for header in ("X-Powered-By", "X-AspNet-Version", "X-AspNetMvc-Version", "Server"):
        if header in response.headers:
            del response.headers[header]


def should_prevent_cache(request: Request) -> bool:
    if request.headers.get("authorization"):
        return True

    path = request.url.path
    return any(path.startswith(prefix) for prefix in NO_STORE_PATH_PREFIXES)


def is_https_non_local_request(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto")
    scheme = forwarded_proto.split(",", 1)[0].strip() if forwarded_proto else request.url.scheme
    if scheme != "https":
        return False

    hostname = request.url.hostname or request.headers.get("host", "").split(":", 1)[0]
    return hostname.lower() not in LOCAL_HOSTNAMES


def is_secure_non_local_websocket(websocket: WebSocket) -> bool:
    forwarded_proto = websocket.headers.get("x-forwarded-proto")
    scheme = forwarded_proto.split(",", 1)[0].strip() if forwarded_proto else websocket.url.scheme
    if scheme not in {"https", "wss"}:
        return False

    hostname = websocket.url.hostname or websocket.headers.get("host", "").split(":", 1)[0]
    return hostname.lower() not in LOCAL_HOSTNAMES
