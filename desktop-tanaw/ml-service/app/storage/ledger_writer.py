from __future__ import annotations

import sqlite3
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from threading import Lock, RLock
from time import monotonic

from app.storage.local_schema import connect_local_database, initialize_local_database


@dataclass
class LedgerWriterInstrumentation:
    connection_open_count: int = 0
    transaction_attempt_count: int = 0
    committed_transaction_count: int = 0
    rolled_back_transaction_count: int = 0
    active_writer_count: int = 0
    maximum_concurrent_writers: int = 0
    lock_wait_observations: int = 0
    latest_lock_wait_ms: float = 0.0
    maximum_lock_wait_ms: float = 0.0
    transaction_duration_observations: int = 0
    latest_transaction_duration_ms: float = 0.0
    maximum_transaction_duration_ms: float = 0.0


class SerializedLedgerWriter:
    """Own the sole long-lived runtime connection and transaction boundary for a ledger."""

    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path
        self._lock = RLock()
        self._connection: sqlite3.Connection | None = None
        self._initialized = False
        self._instrumentation = LedgerWriterInstrumentation()

    def initialize(self, *, enterprise_id: str | None) -> None:
        with self._lock:
            if not self._initialized:
                initialize_local_database(self.database_path, enterprise_id=enterprise_id)
                self._initialized = True
            self._runtime_connection()

    @contextmanager
    def transaction(self, *, immediate: bool) -> Iterator[sqlite3.Connection]:
        wait_started = monotonic()
        with self._lock:
            transaction_started = monotonic()
            connection = self._runtime_connection()
            metrics = self._instrumentation
            lock_wait_ms = max(0.0, (transaction_started - wait_started) * 1000)
            metrics.lock_wait_observations += 1
            metrics.latest_lock_wait_ms = round(lock_wait_ms, 6)
            metrics.maximum_lock_wait_ms = max(
                metrics.maximum_lock_wait_ms,
                metrics.latest_lock_wait_ms,
            )
            metrics.transaction_attempt_count += 1
            if immediate:
                metrics.active_writer_count += 1
                metrics.maximum_concurrent_writers = max(
                    metrics.maximum_concurrent_writers,
                    metrics.active_writer_count,
                )
            try:
                if immediate:
                    connection.execute("begin immediate")
                yield connection
                connection.commit()
                metrics.committed_transaction_count += 1
            except Exception:
                connection.rollback()
                metrics.rolled_back_transaction_count += 1
                raise
            finally:
                transaction_duration_ms = max(0.0, (monotonic() - transaction_started) * 1000)
                metrics.transaction_duration_observations += 1
                metrics.latest_transaction_duration_ms = round(transaction_duration_ms, 6)
                metrics.maximum_transaction_duration_ms = max(
                    metrics.maximum_transaction_duration_ms,
                    metrics.latest_transaction_duration_ms,
                )
                if immediate:
                    metrics.active_writer_count -= 1

    def instrumented_write(
        self,
        operation: Callable[[sqlite3.Connection], None],
    ) -> None:
        with self.transaction(immediate=True) as connection:
            operation(connection)

    def instrumentation(self) -> dict[str, int | float]:
        with self._lock:
            return asdict(self._instrumentation)

    def close(self) -> None:
        with self._lock:
            if self._connection is not None:
                self._connection.close()
                self._connection = None

    def _runtime_connection(self) -> sqlite3.Connection:
        if self._connection is None:
            self._connection = connect_local_database(self.database_path, cross_thread=True)
            self._instrumentation.connection_open_count += 1
        return self._connection


_WRITERS: dict[Path, SerializedLedgerWriter] = {}
_WRITERS_LOCK = Lock()


def writer_for(database_path: Path) -> SerializedLedgerWriter:
    resolved_path = database_path.resolve()
    with _WRITERS_LOCK:
        return _WRITERS.setdefault(resolved_path, SerializedLedgerWriter(resolved_path))


def close_all_ledger_writers() -> None:
    """Release process-owned connections during service shutdown and isolated test cleanup."""

    with _WRITERS_LOCK:
        writers = list(_WRITERS.values())
        _WRITERS.clear()
    for writer in writers:
        writer.close()
