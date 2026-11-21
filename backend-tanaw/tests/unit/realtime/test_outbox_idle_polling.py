"""Idle polling of the realtime outbox worker.

``dispatch_batch`` is replaced by a fake queue, so these tests only exercise
when the worker checks the database, not what it publishes.
"""

import asyncio
import itertools
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest

from app.core.config import get_settings
from app.db.commit_signal import notify_commit
from app.features.realtime import runtime as realtime_runtime


class FakeOutbox:
    def __init__(self) -> None:
        self.pending = 0
        self.checks: list[float] = []

    async def dispatch_batch(self) -> int:
        self.checks.append(asyncio.get_running_loop().time())
        processed, self.pending = self.pending, 0
        return processed

    def gaps(self) -> list[float]:
        return [later - earlier for earlier, later in itertools.pairwise(self.checks)]


@asynccontextmanager
async def outbox_loop(
    monkeypatch: pytest.MonkeyPatch, *, initial: float, maximum: float
) -> AsyncIterator[tuple[FakeOutbox, asyncio.Event, asyncio.Task[None]]]:
    monkeypatch.setattr(realtime_runtime, "REALTIME_OUTBOX_POLL_SECONDS", initial)
    monkeypatch.setattr(realtime_runtime, "REALTIME_OUTBOX_IDLE_POLL_MAX_SECONDS", maximum)
    runtime = realtime_runtime.RealtimeRuntime(get_settings())
    outbox = FakeOutbox()
    monkeypatch.setattr(runtime, "dispatch_batch", outbox.dispatch_batch)
    stop = asyncio.Event()
    task = asyncio.create_task(runtime._outbox_loop(stop))
    try:
        yield outbox, stop, task
    finally:
        stop.set()
        await asyncio.wait_for(task, timeout=2)


async def check_number(outbox: FakeOutbox, number: int, timeout: float = 2.0) -> float:
    """Wait for the worker's ``number``-th database check (1-based) and return its time."""
    deadline = asyncio.get_running_loop().time() + timeout
    while len(outbox.checks) < number:
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("The worker did not check the queue in time.")
        await asyncio.sleep(0.001)
    return outbox.checks[number - 1]


@pytest.mark.asyncio
async def test_idle_worker_backs_off_to_the_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    async with outbox_loop(monkeypatch, initial=0.02, maximum=0.16) as (outbox, _, _):
        await asyncio.sleep(0.75)

    gaps = outbox.gaps()
    # A fixed 0.02 s poll would have checked about 37 times in this window.
    assert len(outbox.checks) <= 9
    assert gaps[:3] == pytest.approx([0.02, 0.04, 0.08], abs=0.015)
    assert all(gap == pytest.approx(0.16, abs=0.03) for gap in gaps[4:])


@pytest.mark.asyncio
async def test_commit_wakes_idle_worker_and_resets_backoff(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with outbox_loop(monkeypatch, initial=0.02, maximum=5.0) as (outbox, _, _):
        # Idle long enough that the next fallback poll is seconds away.
        await asyncio.sleep(0.5)
        seen = len(outbox.checks)
        outbox.pending = 1
        loop = asyncio.get_running_loop()
        committed_at = loop.time()
        notify_commit({"final_reports"})
        checked_at = await check_number(outbox, seen + 1)

        # The first item after an idle period is picked up straight away.
        assert checked_at - committed_at < 0.1
        # After work, the worker re-checks quickly and restarts its backoff.
        follow_up = await check_number(outbox, seen + 2)
        reset_poll = await check_number(outbox, seen + 3)
        assert follow_up - checked_at == pytest.approx(0.05, abs=0.03)
        assert reset_poll - follow_up == pytest.approx(0.02, abs=0.015)


@pytest.mark.asyncio
async def test_own_publish_commits_do_not_wake_the_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with outbox_loop(monkeypatch, initial=0.02, maximum=5.0) as (outbox, _, _):
        await asyncio.sleep(0.5)
        checks_before = len(outbox.checks)
        notify_commit({"realtime_outbox"})
        await asyncio.sleep(0.1)

        assert len(outbox.checks) == checks_before


@pytest.mark.asyncio
async def test_fallback_poll_finds_rows_written_by_another_process(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with outbox_loop(monkeypatch, initial=0.02, maximum=0.1) as (outbox, _, _):
        await asyncio.sleep(0.3)
        # No commit signal: the row came from outside this process.
        outbox.pending = 1
        written_at = asyncio.get_running_loop().time()
        while outbox.pending:
            await asyncio.sleep(0.001)

        assert outbox.checks[-1] - written_at <= 0.1 + 0.03


@pytest.mark.asyncio
async def test_stop_interrupts_a_long_idle_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    async with outbox_loop(monkeypatch, initial=5.0, maximum=10.0) as (outbox, stop, task):
        await check_number(outbox, 1)
        loop = asyncio.get_running_loop()
        stopped_at = loop.time()
        stop.set()
        await asyncio.wait_for(task, timeout=2)

        assert loop.time() - stopped_at < 0.2
