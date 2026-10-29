import os
import sqlite3
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
from weakref import WeakValueDictionary

from app.storage.local_data_schema import initialize_local_database
from app.storage.local_data_serialization import _safe_scope


class _DatabaseChanges:
    def __init__(self) -> None:
        self.version = 0


_CHANGES: WeakValueDictionary[str, _DatabaseChanges] = WeakValueDictionary()
_CHANGES_LOCK = threading.Lock()


class LocalDatabase:
    """Owns scoped paths, schema initialization, and SQLite connection policy."""

    def __init__(self, app_data_dir: str | None, enterprise_id: str | None) -> None:
        base_dir = app_data_dir or os.environ.get("TANAW_APP_DATA_DIR")
        root = Path(base_dir) / "ml-service" if base_dir else Path.home() / ".tanaw" / "ml-service"
        self.root = root / "enterprises" / _safe_scope(enterprise_id) if enterprise_id else root
        self.path = self.root / "tanaw_desktop.sqlite3"
        self.enterprise_id = enterprise_id
        with _CHANGES_LOCK:
            key = str(self.path.resolve())
            changes = _CHANGES.get(key)
            if changes is None:
                changes = _DatabaseChanges()
                _CHANGES[key] = changes
            self._changes = changes
        self._initialized = False
        self._transaction: ContextVar[sqlite3.Connection | None] = ContextVar(
            "local_database_transaction", default=None
        )

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        active = self._transaction.get()
        if active is not None:
            yield active
            return
        self.initialize()
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("pragma foreign_keys = on")
            connection.execute("pragma busy_timeout = 5000")
            yield connection
            connection.commit()
            if connection.total_changes:
                with _CHANGES_LOCK:
                    self._changes.version += 1
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        """Share one atomic write snapshot with this store's nested repositories."""
        if self._transaction.get() is not None:
            raise RuntimeError("A local database transaction is already active.")
        with self.connection() as connection:
            connection.execute("begin immediate")
            token = self._transaction.set(connection)
            try:
                yield connection
            finally:
                self._transaction.reset(token)

    @property
    def change_version(self) -> int:
        """Shared invalidation across all service stores for this database."""
        with _CHANGES_LOCK:
            return self._changes.version

    def initialize(self) -> None:
        if self._initialized:
            return
        initialize_local_database(self.root, self.path, self.enterprise_id)
        self._initialized = True
