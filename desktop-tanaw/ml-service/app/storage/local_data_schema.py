import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from app.storage.migrations import UnsupportedLocalDatabaseError, migrate
from app.storage.migrations.runner import migration_status

# Unreadable local data is moved here instead of being deleted.
SET_ASIDE_DIRECTORY = "set-aside"


class LocalDatabaseResetRequiredError(RuntimeError):
    """Raised when a local database requires an explicit, user-approved reset."""


def initialize_local_database(root: Path, database_path: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    try:
        connection.execute("pragma foreign_keys = on")
        connection.execute("pragma journal_mode = wal")
        connection.execute("pragma synchronous = normal")
        connection.execute("pragma busy_timeout = 5000")
        migrate(connection)
    except UnsupportedLocalDatabaseError as exc:
        raise LocalDatabaseResetRequiredError(
            "The local TANAW data on this computer was saved by an earlier version "
            "and cannot be upgraded by this application."
        ) from exc
    finally:
        connection.close()


def local_database_needs_reset(database_path: Path) -> bool:
    """Whether an existing local database is one this application cannot open."""
    if not database_path.exists():
        return False
    connection = sqlite3.connect(f"{database_path.resolve().as_uri()}?mode=ro", uri=True)
    try:
        return migration_status(connection).error is not None
    finally:
        connection.close()


def set_aside_local_data(root: Path, now: datetime | None = None) -> Path:
    """Move one enterprise's local data folder aside, so a new one can be created.

    The folder is kept under ``ml-service/set-aside`` so its data can still be
    recovered; uninstalling TANAW removes it with the rest of the profile.
    """
    stamp = (now or datetime.now(UTC)).strftime("%Y%m%dT%H%M%SZ")
    target = root.parent.parent / SET_ASIDE_DIRECTORY / f"{root.name}-{stamp}"
    target.parent.mkdir(parents=True, exist_ok=True)
    root.rename(target)
    return target
