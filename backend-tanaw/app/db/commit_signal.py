"""Wake background workers right after a write transaction commits.

The realtime and email outbox workers poll PostgreSQL for pending rows. This
module lets them sleep while idle: every ORM session in this process records
which tables a transaction wrote, and once that transaction commits, each
subscriber interested in one of those tables is woken. Wake-ups are hints only.
Workers still poll on a bounded backoff, so rows written by another process
(such as the sample-data CLI) or by raw SQL are picked up by the fallback poll.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field

from sqlalchemy import event
from sqlalchemy.orm import ORMExecuteState, Session, UOWTransaction

ANY_TABLE = "*"
_WRITTEN_TABLES_KEY = "tanaw_written_tables"


@dataclass(eq=False, slots=True)
class CommitSubscription:
    """A wake-up flag that is set after commits that wrote one of ``tables``.

    ``tables=None`` subscribes to every write commit except one that wrote only
    tables in ``ignore``.
    """

    tables: frozenset[str] | None
    ignore: frozenset[str] = frozenset()
    event: asyncio.Event = field(default_factory=asyncio.Event)
    loop: asyncio.AbstractEventLoop = field(default_factory=asyncio.get_running_loop)

    def wants(self, written: set[str]) -> bool:
        relevant = written - self.ignore
        if not relevant:
            return False
        if self.tables is None or ANY_TABLE in relevant:
            return True
        return not self.tables.isdisjoint(relevant)


_subscriptions: set[CommitSubscription] = set()


def subscribe_to_commits(
    tables: set[str] | None = None,
    *,
    ignore: set[str] | None = None,
) -> CommitSubscription:
    """Register a wake-up flag. Call from the event loop that will wait on it."""
    subscription = CommitSubscription(
        frozenset(tables) if tables is not None else None,
        frozenset(ignore or ()),
    )
    _subscriptions.add(subscription)
    return subscription


def unsubscribe_from_commits(subscription: CommitSubscription) -> None:
    _subscriptions.discard(subscription)


def notify_commit(written: set[str]) -> None:
    """Wake every subscriber interested in ``written``; safe from any thread."""
    for subscription in tuple(_subscriptions):
        if not subscription.wants(written):
            continue
        try:
            subscription.loop.call_soon_threadsafe(subscription.event.set)
        except RuntimeError:
            # The subscriber's loop has closed; it can no longer be woken.
            _subscriptions.discard(subscription)


def _record_tables(session: Session, tables: set[str]) -> None:
    session.info.setdefault(_WRITTEN_TABLES_KEY, set()).update(tables)


@event.listens_for(Session, "after_flush")
def _after_flush(session: Session, _flush_context: UOWTransaction) -> None:
    tables: set[str] = set()
    for instance in (*session.new, *session.dirty, *session.deleted):
        table = getattr(instance, "__tablename__", None)
        tables.add(table if isinstance(table, str) else ANY_TABLE)
    if tables:
        _record_tables(session, tables)


@event.listens_for(Session, "do_orm_execute")
def _after_bulk_statement(state: ORMExecuteState) -> None:
    if not (state.is_insert or state.is_update or state.is_delete):
        return
    table = getattr(state.statement, "table", None)
    name = getattr(table, "name", None)
    _record_tables(state.session, {name if isinstance(name, str) else ANY_TABLE})


@event.listens_for(Session, "after_commit")
def _after_commit(session: Session) -> None:
    written = session.info.pop(_WRITTEN_TABLES_KEY, None)
    if written:
        notify_commit(written)


@event.listens_for(Session, "after_rollback")
def _after_rollback(session: Session) -> None:
    session.info.pop(_WRITTEN_TABLES_KEY, None)


async def wait_for_wake(
    subscription: CommitSubscription,
    stop_event: asyncio.Event,
    timeout: float,
) -> None:
    """Sleep until a matching commit, a stop request, or ``timeout`` seconds."""
    if subscription.event.is_set() or stop_event.is_set():
        return
    waiters = {
        asyncio.ensure_future(subscription.event.wait()),
        asyncio.ensure_future(stop_event.wait()),
    }
    try:
        await asyncio.wait(waiters, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for waiter in waiters:
            waiter.cancel()
        await asyncio.gather(*waiters, return_exceptions=True)


@dataclass(slots=True)
class IdleBackoff:
    """Polling delay that doubles while a queue stays empty, up to ``maximum``."""

    initial: float
    maximum: float
    factor: float = 2.0
    _next: float = field(init=False)

    def __post_init__(self) -> None:
        if not 0 < self.initial <= self.maximum:
            raise ValueError("IdleBackoff needs 0 < initial <= maximum.")
        if self.factor < 1:
            raise ValueError("IdleBackoff factor must be at least 1.")
        self._next = self.initial

    def reset(self) -> None:
        self._next = self.initial

    def next_delay(self) -> float:
        delay = self._next
        self._next = min(delay * self.factor, self.maximum)
        return delay
