from __future__ import annotations

import sqlite3
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from threading import Lock, RLock

from app.storage.local_schema import connect_local_database, initialize_local_database


@dataclass
class LedgerWriterInstrumentation:
    connection_open_count: int = 0
    transaction_attempt_count: int = 0
    committed_transaction_count: int = 0
    rolled_back_transaction_count: int = 0
    active_writer_count: int = 0
    maximum_concurrent_writers: int = 0


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
        with self._lock:
            connection = self._runtime_connection()
            metrics = self._instrumentation
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
                if immediate:
                    metrics.active_writer_count -= 1

    def instrumented_write(
        self,
        operation: Callable[[sqlite3.Connection], None],
    ) -> None:
        with self.transaction(immediate=True) as connection:
            operation(connection)

    def instrumentation(self) -> dict[str, int]:
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
