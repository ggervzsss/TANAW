"""Who made the current HTTP request, for the technical detail IT sees in Activity.

A small ASGI middleware stores the caller's IP address, browser and a short session identifier
in a context variable for the length of each HTTP request. Activity records read it, so every
log written while a request is handled carries these details without each caller passing them.
The session identifier is a truncated hash of the bearer token, never the token itself.
"""

import hashlib
from collections.abc import Iterable
from contextvars import ContextVar
from dataclasses import dataclass

from starlette.types import ASGIApp, Receive, Scope, Send

MAX_IP_ADDRESS_LENGTH = 64
MAX_USER_AGENT_LENGTH = 400
SESSION_ID_LENGTH = 16


@dataclass(frozen=True)
class RequestContext:
    ip_address: str | None = None
    user_agent: str | None = None
    session_id: str | None = None


EMPTY_REQUEST_CONTEXT = RequestContext()
_request_context: ContextVar[RequestContext] = ContextVar(
    "tanaw_request_context", default=EMPTY_REQUEST_CONTEXT
)


def current_request_context() -> RequestContext:
    """The details of the HTTP request being handled, or an empty context outside one."""
    return _request_context.get()


def session_identifier(token: str | None) -> str | None:
    """A short, non-secret identifier for a bearer token: never the token itself."""
    if not token:
        return None
    digest = hashlib.sha256(f"tanaw-session:{token}".encode()).hexdigest()
    return digest[:SESSION_ID_LENGTH]


def _clip(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    cleaned = " ".join(value.split())
    return cleaned[:limit] or None


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.strip().partition(" ")
    if scheme.lower() != "bearer":
        return None
    return token.strip() or None


def build_request_context(
    client_host: str | None, headers: Iterable[tuple[bytes, bytes]]
) -> RequestContext:
    values: dict[str, str] = {}
    for raw_name, raw_value in headers:
        name = raw_name.decode("latin-1").lower()
        if name in {"user-agent", "authorization"} and name not in values:
            values[name] = raw_value.decode("latin-1")
    return RequestContext(
        ip_address=_clip(client_host, MAX_IP_ADDRESS_LENGTH),
        user_agent=_clip(values.get("user-agent"), MAX_USER_AGENT_LENGTH),
        session_id=session_identifier(_bearer_token(values.get("authorization"))),
    )


class RequestContextMiddleware:
    """Set the request context for each HTTP request, and clear it afterwards."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        client = scope.get("client")
        context = build_request_context(client[0] if client else None, scope.get("headers") or [])
        token = _request_context.set(context)
        try:
            await self.app(scope, receive, send)
        finally:
            _request_context.reset(token)
