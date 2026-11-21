"""Heartbeat and session-validation schedule of the realtime WebSocket.

The fake client below answers every ``realtime.heartbeat`` with
``{"type":"realtime.pong"}``, exactly as the web portal and the desktop app do.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import WebSocket, WebSocketDisconnect

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.realtime import router as realtime_router

PONG = json.dumps({"type": "realtime.pong"})
PING = json.dumps({"type": "realtime.ping"})
_DISCONNECT = object()


class FakeClient:
    """A socket whose inbound messages come from a queue the test controls."""

    def __init__(self, *, answers_heartbeats: bool) -> None:
        self.answers_heartbeats = answers_heartbeats
        self.inbound: asyncio.Queue[object] = asyncio.Queue()
        self.websocket = MagicMock()
        self.websocket.receive_text = self._receive_text

    async def _receive_text(self) -> str:
        message = await self.inbound.get()
        if message is _DISCONNECT:
            raise WebSocketDisconnect(code=1000)
        return cast(str, message)

    def send(self, message: str) -> None:
        self.inbound.put_nowait(message)

    def disconnect(self) -> None:
        self.inbound.put_nowait(_DISCONNECT)


class FakeManager:
    """Stands in for the connection manager and records what the server sends."""

    def __init__(self, client: FakeClient) -> None:
        self.client = client
        self.sent: list[dict[str, Any]] = []
        self.closes: list[tuple[int | None, str]] = []
        self.heartbeat_sent = asyncio.Event()
        self.closed = asyncio.Event()

    async def connect(self, *_: object) -> None:
        return None

    async def send_protocol(self, _websocket: object, message: dict[str, Any]) -> bool:
        self.sent.append(message)
        if message["type"] == "realtime.heartbeat":
            self.heartbeat_sent.set()
            if self.client.answers_heartbeats:
                self.client.send(PONG)
        return True

    async def disconnect(
        self,
        _websocket: object,
        *,
        close_code: int | None = None,
        reason: str = "disconnected",
    ) -> None:
        self.closes.append((close_code, reason))
        if close_code is not None:
            self.closed.set()

    @property
    def heartbeats(self) -> int:
        return sum(message["type"] == "realtime.heartbeat" for message in self.sent)


class SessionContext:
    def __init__(self) -> None:
        self.session = MagicMock()
        self.session.scalar = AsyncMock(return_value=0)

    async def __aenter__(self) -> MagicMock:
        return self.session

    async def __aexit__(self, *_: object) -> None:
        return None


class ReadyMessage:
    """Accepts the fractional test intervals that the real contract rejects."""

    def __init__(self, **fields: object) -> None:
        self.fields = fields

    def model_dump(self, **_: object) -> dict[str, object]:
        return {"type": "realtime.ready", **self.fields}


def active_account() -> Account:
    return Account(
        id="realtime-account-1",
        email="realtime-staff@example.com",
        password_hash="unused-password-hash",
        role=AccountRole.STAFF,
        display_name="Realtime Staff",
        title="Staff",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
    )


@asynccontextmanager
async def serve(
    monkeypatch: pytest.MonkeyPatch,
    *,
    heartbeat_seconds: float,
    answers_heartbeats: bool = True,
    authenticate: AsyncMock | None = None,
    token_lifetime_seconds: float = 3600,
) -> AsyncIterator[tuple[FakeClient, FakeManager, AsyncMock, asyncio.Task[None]]]:
    client = FakeClient(answers_heartbeats=answers_heartbeats)
    manager = FakeManager(client)
    lookups = authenticate or AsyncMock(return_value=active_account())
    expires_at = time.time() + token_lifetime_seconds
    monkeypatch.setattr(realtime_router, "REALTIME_HEARTBEAT_SECONDS", heartbeat_seconds)
    monkeypatch.setattr(realtime_router, "RealtimeReady", ReadyMessage)
    monkeypatch.setattr(
        realtime_router,
        "receive_websocket_bearer_token",
        AsyncMock(return_value="access-token"),
    )
    monkeypatch.setattr(realtime_router, "authenticate_websocket_account", lookups)
    monkeypatch.setattr(
        realtime_router,
        "decode_access_token",
        lambda _token: {"sub": "realtime-account-1", "exp": expires_at},
    )
    monkeypatch.setattr(realtime_router, "AsyncSessionLocal", SessionContext)
    monkeypatch.setattr(realtime_router, "realtime_manager", manager)
    task = asyncio.create_task(
        realtime_router.realtime_websocket(cast(WebSocket, client.websocket))
    )
    try:
        yield client, manager, lookups, task
    finally:
        if not task.done():
            client.disconnect()
        await asyncio.wait_for(task, timeout=2)


async def wait_until(condition: Callable[[], bool], timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while not condition():
        if time.monotonic() > deadline:
            raise AssertionError("Condition was not met in time.")
        await asyncio.sleep(0.005)


@pytest.mark.asyncio
async def test_client_pong_ends_the_heartbeat_exchange(monkeypatch: pytest.MonkeyPatch) -> None:
    async with serve(monkeypatch, heartbeat_seconds=0.2) as (client, manager, lookups, _):
        await asyncio.wait_for(manager.heartbeat_sent.wait(), timeout=2)
        # The fake client has now answered with realtime.pong, as both apps do.
        await asyncio.sleep(0.08)

        assert manager.heartbeats == 1
        # One lookup to open the socket and one for the scheduled check; the pong adds none.
        assert lookups.await_count == 2
        assert client.inbound.empty()


@pytest.mark.asyncio
async def test_unsolicited_pong_neither_heartbeats_nor_looks_up(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with serve(monkeypatch, heartbeat_seconds=60) as (client, manager, lookups, _):
        for _ in range(20):
            client.send(PONG)
        await wait_until(client.inbound.empty)
        await asyncio.sleep(0.02)

        assert manager.heartbeats == 0
        assert lookups.await_count == 1


@pytest.mark.asyncio
async def test_idle_connection_stays_open_on_the_scheduled_cadence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    interval = 0.1
    async with serve(monkeypatch, heartbeat_seconds=interval) as (_, manager, lookups, task):
        started = time.monotonic()
        await wait_until(lambda: manager.heartbeats >= 4)
        elapsed = time.monotonic() - started

        # Four heartbeats span more than two intervals, the silence limit, so the
        # pong replies keep the idle connection healthy.
        assert elapsed >= 3.5 * interval
        assert not task.done()
        assert manager.closes == []
        assert lookups.await_count == 1 + manager.heartbeats


@pytest.mark.asyncio
async def test_client_messages_do_not_add_lookups_or_postpone_the_check(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    interval = 0.1
    async with serve(monkeypatch, heartbeat_seconds=interval) as (client, manager, lookups, _):
        started = time.monotonic()
        while time.monotonic() - started < 2.5 * interval:
            client.send(PING)
            await asyncio.sleep(0.01)

        scheduled_checks = lookups.await_count - 1
        # Pings arrive every 10 ms, yet checks still run at 0.1 s and 0.2 s.
        assert scheduled_checks in {2, 3}
        # Every ping got a heartbeat reply without an account lookup.
        assert manager.heartbeats > 10


@pytest.mark.asyncio
async def test_scheduled_check_closes_an_invalidated_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lookups = AsyncMock(side_effect=[active_account(), active_account(), None])
    async with serve(monkeypatch, heartbeat_seconds=0.05, authenticate=lookups) as (
        _,
        manager,
        _,
        task,
    ):
        await asyncio.wait_for(manager.closed.wait(), timeout=2)
        await asyncio.wait_for(task, timeout=2)

    assert manager.closes[0] == (4401, "session_invalidated")
    assert lookups.await_count == 3
    assert manager.heartbeats == 1


@pytest.mark.asyncio
async def test_scheduled_check_closes_when_the_account_role_changes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    demoted = active_account()
    demoted.role = AccountRole.ENTERPRISE
    lookups = AsyncMock(side_effect=[active_account(), demoted])
    async with serve(monkeypatch, heartbeat_seconds=0.05, authenticate=lookups) as (
        _,
        manager,
        _,
        _,
    ):
        await asyncio.wait_for(manager.closed.wait(), timeout=2)

    assert manager.closes[0] == (4401, "session_invalidated")
    assert manager.heartbeats == 0


@pytest.mark.asyncio
async def test_token_expiry_closes_without_waiting_for_the_check(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with serve(monkeypatch, heartbeat_seconds=60, token_lifetime_seconds=0.05) as (
        _,
        manager,
        lookups,
        _,
    ):
        await asyncio.wait_for(manager.closed.wait(), timeout=2)

    assert manager.closes[0] == (4401, "session_expired")
    assert lookups.await_count == 1


@pytest.mark.asyncio
async def test_silent_client_is_closed_after_two_intervals(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    interval = 0.05
    async with serve(monkeypatch, heartbeat_seconds=interval, answers_heartbeats=False) as (
        _,
        manager,
        _,
        _,
    ):
        started = time.monotonic()
        await asyncio.wait_for(manager.closed.wait(), timeout=2)
        elapsed = time.monotonic() - started

    assert manager.closes[0] == (1013, "heartbeat_timeout")
    assert elapsed >= 2 * interval
    assert manager.heartbeats == 1
