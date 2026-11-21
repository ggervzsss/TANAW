import asyncio
from collections.abc import Iterator

import pytest
from sqlalchemy import String, create_engine, update
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from app.db.commit_signal import (
    IdleBackoff,
    notify_commit,
    subscribe_to_commits,
    unsubscribe_from_commits,
    wait_for_wake,
)


class SignalBase(DeclarativeBase):
    pass


class QueuedEmail(SignalBase):
    __tablename__ = "email_outbox"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    status: Mapped[str] = mapped_column(String)


class OtherRecord(SignalBase):
    __tablename__ = "final_reports"

    id: Mapped[str] = mapped_column(String, primary_key=True)


@pytest.fixture
def session() -> Iterator[Session]:
    engine = create_engine("sqlite://")
    SignalBase.metadata.create_all(engine)
    with Session(engine) as db:
        yield db
    engine.dispose()


async def settle() -> None:
    # Wake-ups are delivered with call_soon_threadsafe on the subscriber's loop.
    await asyncio.sleep(0)
    await asyncio.sleep(0)


@pytest.mark.asyncio
async def test_write_commit_wakes_only_subscribers_for_written_tables(session: Session) -> None:
    email = subscribe_to_commits({"email_outbox"})
    reports = subscribe_to_commits({"final_reports"})
    try:
        session.add(QueuedEmail(id="email-1", status="queued"))
        session.commit()
        await settle()

        assert email.event.is_set()
        assert not reports.event.is_set()
    finally:
        unsubscribe_from_commits(email)
        unsubscribe_from_commits(reports)


@pytest.mark.asyncio
async def test_read_only_and_rolled_back_transactions_do_not_wake(session: Session) -> None:
    email = subscribe_to_commits({"email_outbox"})
    try:
        session.get(QueuedEmail, "missing")
        session.commit()
        session.add(QueuedEmail(id="email-1", status="queued"))
        session.flush()
        session.rollback()
        session.commit()
        await settle()

        assert not email.event.is_set()
    finally:
        unsubscribe_from_commits(email)


@pytest.mark.asyncio
async def test_bulk_update_statement_wakes(session: Session) -> None:
    session.add(QueuedEmail(id="email-1", status="processing"))
    session.commit()
    email = subscribe_to_commits({"email_outbox"})
    try:
        session.execute(update(QueuedEmail).values(status="retry_scheduled"))
        session.commit()
        await settle()

        assert email.event.is_set()
    finally:
        unsubscribe_from_commits(email)


@pytest.mark.asyncio
async def test_any_table_subscription_skips_commits_to_ignored_tables(session: Session) -> None:
    everything = subscribe_to_commits(ignore={"email_outbox"})
    try:
        session.add(QueuedEmail(id="email-1", status="queued"))
        session.commit()
        await settle()
        assert not everything.event.is_set()

        session.add(OtherRecord(id="report-1"))
        session.commit()
        await settle()
        assert everything.event.is_set()
    finally:
        unsubscribe_from_commits(everything)


@pytest.mark.asyncio
async def test_wait_for_wake_returns_on_commit_stop_or_timeout() -> None:
    wake = subscribe_to_commits({"email_outbox"})
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    try:
        started = loop.time()
        await wait_for_wake(wake, stop, timeout=0.02)
        assert loop.time() - started >= 0.015

        loop.call_later(0.01, notify_commit, {"email_outbox"})
        started = loop.time()
        await wait_for_wake(wake, stop, timeout=5)
        assert loop.time() - started < 1

        wake.event.clear()
        loop.call_later(0.01, stop.set)
        started = loop.time()
        await wait_for_wake(wake, stop, timeout=5)
        assert loop.time() - started < 1
    finally:
        unsubscribe_from_commits(wake)


def test_idle_backoff_doubles_to_the_cap_and_resets() -> None:
    backoff = IdleBackoff(0.5, 10.0)

    assert [backoff.next_delay() for _ in range(7)] == [0.5, 1.0, 2.0, 4.0, 8.0, 10.0, 10.0]
    backoff.reset()
    assert backoff.next_delay() == 0.5


def test_idle_backoff_rejects_inverted_bounds() -> None:
    with pytest.raises(ValueError):
        IdleBackoff(5.0, 1.0)
