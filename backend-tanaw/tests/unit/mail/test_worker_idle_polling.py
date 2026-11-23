"""Idle polling of the email outbox worker.

``run_email_outbox_batch`` is replaced by a fake queue, so these tests only
exercise when the worker checks the database, not how it delivers. The backoff
is checked through the waits the worker requests rather than measured sleeps,
because Windows timers fire in steps of about 15.6 ms.
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import pytest

from app.core.config import Settings, get_settings
from app.db.commit_signal import CommitSubscription, notify_commit, wait_for_wake
from app.features.mail import worker as mail_worker


class FakeEmailQueue:
    def __init__(self) -> None:
        self.pending = 0
        self.checks: list[float] = []
        # The idle wait requested after each empty check, in order.
        self.delays: list[float] = []

    async def run_batch(self, _settings: object) -> int:
        self.checks.append(asyncio.get_running_loop().time())
        processed, self.pending = self.pending, 0
        return processed

    async def wait(
        self, subscription: CommitSubscription, stop_event: asyncio.Event, timeout: float
    ) -> None:
        self.delays.append(timeout)
        await wait_for_wake(subscription, stop_event, timeout)


def worker_settings(*, initial: float, maximum: float) -> Settings:
    return get_settings().model_copy(
        update={
            "email_outbox_poll_interval_seconds": initial,
            "email_outbox_idle_poll_max_seconds": maximum,
        }
    )


@asynccontextmanager
async def worker_loop(
    monkeypatch: pytest.MonkeyPatch, *, initial: float, maximum: float
) -> AsyncIterator[tuple[FakeEmailQueue, asyncio.Event, asyncio.Task[None]]]:
    settings = worker_settings(initial=initial, maximum=maximum)
    queue = FakeEmailQueue()
    monkeypatch.setattr(mail_worker, "run_email_outbox_batch", queue.run_batch)
    monkeypatch.setattr(mail_worker, "wait_for_wake", queue.wait)
    stop = asyncio.Event()
    task = asyncio.create_task(mail_worker._worker_loop(settings, stop))
    try:
        yield queue, stop, task
    finally:
        stop.set()
        await asyncio.wait_for(task, timeout=2)


async def check_number(queue: FakeEmailQueue, number: int, timeout: float = 2.0) -> float:
    """Wait for the worker's ``number``-th database check (1-based) and return its time."""
    deadline = asyncio.get_running_loop().time() + timeout
    while len(queue.checks) < number:
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("The worker did not check the queue in time.")
        await asyncio.sleep(0.001)
    return queue.checks[number - 1]


@pytest.mark.asyncio
async def test_idle_email_worker_backs_off_to_the_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    queue = FakeEmailQueue()
    stop = asyncio.Event()

    async def wait_without_sleeping(
        _subscription: CommitSubscription, _stop_event: asyncio.Event, timeout: float
    ) -> None:
        queue.delays.append(timeout)
        if len(queue.delays) == 7:
            stop.set()
        await asyncio.sleep(0)

    monkeypatch.setattr(mail_worker, "run_email_outbox_batch", queue.run_batch)
    monkeypatch.setattr(mail_worker, "wait_for_wake", wait_without_sleeping)
    await asyncio.wait_for(
        mail_worker._worker_loop(worker_settings(initial=0.02, maximum=0.16), stop), timeout=2
    )

    assert len(queue.checks) == 7
    assert queue.delays == pytest.approx([0.02, 0.04, 0.08, 0.16, 0.16, 0.16, 0.16])


@pytest.mark.asyncio
async def test_queued_email_wakes_idle_worker_and_resets_backoff(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with worker_loop(monkeypatch, initial=0.02, maximum=5.0) as (queue, _, _):
        await asyncio.sleep(0.5)
        seen = len(queue.checks)
        queue.pending = 1
        loop = asyncio.get_running_loop()
        queued_at = loop.time()
        notify_commit({"email_outbox"})
        claimed_at = await check_number(queue, seen + 1)

        assert claimed_at - queued_at < 0.1
        # Work found: the worker claims again without waiting, then backs off afresh.
        await check_number(queue, seen + 2)
        # Every empty check is followed by one wait, and the claim that found work by none.
        assert queue.delays[seen - 1] > 0.02
        assert queue.delays[seen] == pytest.approx(0.02)


@pytest.mark.asyncio
async def test_unrelated_commits_do_not_wake_the_email_worker(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async with worker_loop(monkeypatch, initial=0.02, maximum=5.0) as (queue, _, _):
        await asyncio.sleep(0.5)
        checks_before = len(queue.checks)
        notify_commit({"enterprise_telemetry_snapshots"})
        await asyncio.sleep(0.1)

        assert len(queue.checks) == checks_before


@pytest.mark.asyncio
async def test_failed_batch_backs_off_instead_of_spinning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    checks: list[float] = []

    async def failing_batch(_settings: object) -> int:
        checks.append(asyncio.get_running_loop().time())
        raise RuntimeError("database unavailable")

    settings = get_settings().model_copy(
        update={
            "email_outbox_poll_interval_seconds": 0.02,
            "email_outbox_idle_poll_max_seconds": 0.16,
        }
    )
    monkeypatch.setattr(mail_worker, "run_email_outbox_batch", failing_batch)
    stop = asyncio.Event()
    task = asyncio.create_task(mail_worker._worker_loop(settings, stop))
    await asyncio.sleep(0.5)
    stop.set()
    await asyncio.wait_for(task, timeout=2)

    assert 3 <= len(checks) <= 8


@pytest.mark.asyncio
async def test_stop_interrupts_a_long_idle_email_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    async with worker_loop(monkeypatch, initial=5.0, maximum=10.0) as (queue, stop, task):
        await check_number(queue, 1)
        loop = asyncio.get_running_loop()
        stopped_at = loop.time()
        stop.set()
        await asyncio.wait_for(task, timeout=2)

        assert loop.time() - stopped_at < 0.2
