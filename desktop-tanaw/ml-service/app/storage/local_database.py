import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from app.storage.local_data_schema import initialize_local_database
from app.storage.local_data_serialization import _safe_scope


class LocalDatabase:
    """Owns scoped paths, schema initialization, and SQLite connection policy."""

    def __init__(self, app_data_dir: str | None, enterprise_id: str | None) -> None:
        base_dir = app_data_dir or os.environ.get("TANAW_APP_DATA_DIR")
        root = Path(base_dir) / "ml-service" if base_dir else Path.home() / ".tanaw" / "ml-service"
        self.root = root / "enterprises" / _safe_scope(enterprise_id) if enterprise_id else root
        self.path = self.root / "tanaw_desktop.sqlite3"
        self.enterprise_id = enterprise_id
        self._initialized = False

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        self.initialize()
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("pragma foreign_keys = on")
            connection.execute("pragma busy_timeout = 5000")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        if self._initialized:
            return
        initialize_local_database(self.root, self.path, self.enterprise_id)
        self._initialized = True
