from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import queue
import secrets
import threading
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from time import monotonic
from typing import Final, Literal, cast
from uuid import UUID

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from starlette.middleware.base import BaseHTTPMiddleware

LOCAL_CONTRACT_VERSION: Final = 2
LOCAL_RELEASE_ID: Final = "target-cutover-release"
LOCAL_SERVICE_VERSION: Final = "2.0.0"
LOCAL_SERVICE_NAME: Final = "tanaw-ml-service"
BOOTSTRAP_TIMEOUT_SECONDS: Final = 5.0
MAX_BOOTSTRAP_BYTES: Final = 4096
MAX_REQUEST_BYTES: Final = 1_048_576
SESSION_TTL_SECONDS: Final = 45
SESSION_TOKEN_PREFIX: Final = "tanaw-session."
LAUNCH_ID_PROTOCOL_PREFIX: Final = "tanaw-launch."

SessionScope = Literal["camera-events", "stream"]


class BootstrapError(ValueError):
    """Raised when the private launch bootstrap is absent or malformed."""


@dataclass(frozen=True, slots=True)
class LaunchBootstrap:
    capability: str
    launch_id: str


@dataclass(frozen=True, slots=True)
class ReadinessIdentity:
    launch_id: str
    pid: int
    port: int
    startup_nonce: str


@dataclass(frozen=True, slots=True)
class AuthenticatedSession:
    digest: bytes
    expires_at: float
    scope: SessionScope


@dataclass(frozen=True, slots=True)
class _StoredSession:
    expires_at: float
    scope: SessionScope


class SessionMintRequest(BaseModel):
    scope: SessionScope
    ttl_seconds: int = Field(default=SESSION_TTL_SECONDS, ge=5, le=SESSION_TTL_SECONDS)


class SessionMintResponse(BaseModel):
    token: str
    expires_in_seconds: int
    scope: SessionScope


class LocalCapabilityAuthority:
    def __init__(self, bootstrap: LaunchBootstrap, startup_nonce: str) -> None:
        self._capability = bootstrap.capability
        self.launch_id = bootstrap.launch_id
        self.startup_nonce = startup_nonce
        self._sessions: dict[bytes, _StoredSession] = {}
        self._request_windows: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def authenticate_master(self, authorization: str | None, launch_id: str | None) -> bool:
        if launch_id is None or not hmac.compare_digest(launch_id, self.launch_id):
            return False
        if authorization is None:
            return False
        scheme, separator, supplied = authorization.partition(" ")
        return bool(
            separator
            and scheme == "TANAW-Capability"
            and supplied
            and hmac.compare_digest(supplied, self._capability)
        )

    def mint_session(self, scope: SessionScope, ttl_seconds: int) -> SessionMintResponse:
        token = _base64url(secrets.token_bytes(32))
        digest = _token_digest(token)
        now = monotonic()
        with self._lock:
            self._purge_expired_sessions(now)
            self._sessions[digest] = _StoredSession(
                expires_at=now + ttl_seconds,
                scope=scope,
            )
        return SessionMintResponse(
            token=token,
            expires_in_seconds=ttl_seconds,
            scope=scope,
        )

    def authenticate_session(
        self,
        token: str | None,
        launch_id: str | None,
        required_scope: SessionScope,
    ) -> AuthenticatedSession | None:
        if token is None or launch_id is None:
            return None
        if not hmac.compare_digest(launch_id, self.launch_id):
            return None
        digest = _token_digest(token)
        now = monotonic()
        with self._lock:
            self._purge_expired_sessions(now)
            stored = self._sessions.get(digest)
            if stored is None or stored.scope != required_scope:
                return None
            return AuthenticatedSession(
                digest=digest,
                expires_at=stored.expires_at,
                scope=stored.scope,
            )

    def authenticate_session_authorization(
        self,
        authorization: str | None,
        launch_id: str | None,
        required_scope: SessionScope,
    ) -> AuthenticatedSession | None:
        if authorization is None:
            return None
        scheme, separator, token = authorization.partition(" ")
        if not separator or scheme != "TANAW-Session":
            return None
        return self.authenticate_session(token, launch_id, required_scope)

    def authenticate_websocket(
        self,
        websocket: WebSocket,
        required_scope: SessionScope,
    ) -> tuple[AuthenticatedSession | None, str | None]:
        if websocket.headers.get("origin"):
            return None, None
        protocols = [
            protocol.strip()
            for protocol in websocket.headers.get("sec-websocket-protocol", "").split(",")
        ]
        launch_id = websocket.headers.get("x-tanaw-launch-id")
        if launch_id is None:
            launch_id = next(
                (
                    protocol.removeprefix(LAUNCH_ID_PROTOCOL_PREFIX)
                    for protocol in protocols
                    if protocol.startswith(LAUNCH_ID_PROTOCOL_PREFIX)
                ),
                None,
            )
        for candidate in protocols:
            if not candidate.startswith(SESSION_TOKEN_PREFIX):
                continue
            token = candidate.removeprefix(SESSION_TOKEN_PREFIX)
            authenticated = self.authenticate_session(token, launch_id, required_scope)
            if authenticated is not None:
                return authenticated, candidate
        return None, None

    def session_is_active(self, session: AuthenticatedSession) -> bool:
        if session.digest == b"master":
            return True
        now = monotonic()
        with self._lock:
            self._purge_expired_sessions(now)
            stored = self._sessions.get(session.digest)
            return bool(
                stored and stored.scope == session.scope and stored.expires_at == session.expires_at
            )

    def health_challenge_response(self, challenge: str) -> str:
        message = f"health:{self.launch_id}:{self.startup_nonce}:{challenge}".encode()
        digest = hmac.new(self._capability.encode(), message, hashlib.sha256).digest()
        return _base64url(digest)

    def allow_request(self, bucket: str, limit: int, window_seconds: float) -> bool:
        now = monotonic()
        cutoff = now - window_seconds
        with self._lock:
            timestamps = self._request_windows.setdefault(bucket, deque())
            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()
            if len(timestamps) >= limit:
                return False
            timestamps.append(now)
            return True

    def _purge_expired_sessions(self, now: float) -> None:
        expired = [
            digest for digest, session in self._sessions.items() if session.expires_at <= now
        ]
        for digest in expired:
            del self._sessions[digest]


class LocalCapabilityMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        authority = get_authority(request.app)
        if authority is None or request.headers.get("origin"):
            return unauthorized_response()

        launch_id = request.headers.get("x-tanaw-launch-id")
        authorization = request.headers.get("authorization")
        if request.url.path == "/stream":
            authenticated_session = authority.authenticate_session_authorization(
                authorization,
                launch_id,
                "stream",
            )
            if authenticated_session is None:
                return unauthorized_response()
            request.state.local_authenticated_session = authenticated_session
        elif not authority.authenticate_master(authorization, launch_id):
            return unauthorized_response()

        bucket = "stream" if request.url.path == "/stream" else "master"
        limit = 30 if bucket == "stream" else 300
        if not authority.allow_request(bucket, limit, 10.0):
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests"},
                headers={"Cache-Control": "no-store"},
            )

        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                if int(content_length) > MAX_REQUEST_BYTES:
                    return JSONResponse(
                        status_code=413,
                        content={"detail": "Request too large"},
                        headers={"Cache-Control": "no-store"},
                    )
            except ValueError:
                return JSONResponse(
                    status_code=400,
                    content={"detail": "Invalid request"},
                    headers={"Cache-Control": "no-store"},
                )
        body = await request.body()
        if len(body) > MAX_REQUEST_BYTES:
            return JSONResponse(
                status_code=413,
                content={"detail": "Request too large"},
                headers={"Cache-Control": "no-store"},
            )
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response


def install_launch_security(
    target_app: FastAPI,
    bootstrap: LaunchBootstrap,
    startup_nonce: str,
) -> LocalCapabilityAuthority:
    authority = LocalCapabilityAuthority(bootstrap, startup_nonce)
    target_app.state.local_capability_authority = authority
    return authority


def get_authority(target: FastAPI | Request) -> LocalCapabilityAuthority | None:
    app = target.app if isinstance(target, Request) else target
    return cast(
        LocalCapabilityAuthority | None,
        getattr(app.state, "local_capability_authority", None),
    )


def get_authenticated_session(request: Request) -> AuthenticatedSession | None:
    return cast(
        AuthenticatedSession | None,
        getattr(request.state, "local_authenticated_session", None),
    )


def parse_bootstrap_payload(raw: bytes) -> LaunchBootstrap:
    if not raw or len(raw) > MAX_BOOTSTRAP_BYTES:
        raise BootstrapError("Invalid local service bootstrap.")
    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BootstrapError("Invalid local service bootstrap.") from exc
    if not isinstance(payload, dict) or set(payload) != {
        "capability",
        "contractVersion",
        "launchId",
    }:
        raise BootstrapError("Invalid local service bootstrap.")
    if payload["contractVersion"] != LOCAL_CONTRACT_VERSION:
        raise BootstrapError("Invalid local service bootstrap.")
    launch_id = payload["launchId"]
    capability = payload["capability"]
    if not isinstance(launch_id, str) or not isinstance(capability, str):
        raise BootstrapError("Invalid local service bootstrap.")
    try:
        UUID(launch_id)
        decoded = base64.urlsafe_b64decode(capability + "=" * (-len(capability) % 4))
    except (ValueError, TypeError) as exc:
        raise BootstrapError("Invalid local service bootstrap.") from exc
    if len(decoded) != 32 or _base64url(decoded) != capability:
        raise BootstrapError("Invalid local service bootstrap.")
    return LaunchBootstrap(capability=capability, launch_id=launch_id)


def read_bootstrap_from_stdin(
    timeout_seconds: float = BOOTSTRAP_TIMEOUT_SECONDS,
) -> LaunchBootstrap:
    result_queue: queue.Queue[bytes | BaseException] = queue.Queue(maxsize=1)

    def read_private_pipe() -> None:
        try:
            result_queue.put(os.fdopen(0, "rb", closefd=False).read(MAX_BOOTSTRAP_BYTES + 1))
        except BaseException as exc:  # pragma: no cover - platform pipe failure
            result_queue.put(exc)

    threading.Thread(target=read_private_pipe, daemon=True).start()
    try:
        result = result_queue.get(timeout=timeout_seconds)
    except queue.Empty as exc:
        raise BootstrapError("Local service bootstrap timed out.") from exc
    if isinstance(result, BaseException):
        raise BootstrapError("Invalid local service bootstrap.") from result
    return parse_bootstrap_payload(result)


def build_readiness_record(identity: ReadinessIdentity) -> dict[str, object]:
    return {
        "serviceName": LOCAL_SERVICE_NAME,
        "localContractVersion": LOCAL_CONTRACT_VERSION,
        "releaseId": LOCAL_RELEASE_ID,
        "launchId": identity.launch_id,
        "pid": identity.pid,
        "port": identity.port,
        "startupNonce": identity.startup_nonce,
    }


def unauthorized_response() -> JSONResponse:
    return JSONResponse(
        status_code=401,
        content={"detail": "Unauthorized"},
        headers={"Cache-Control": "no-store"},
    )


def _token_digest(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")
