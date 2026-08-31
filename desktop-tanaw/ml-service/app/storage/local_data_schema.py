import sqlite3
from pathlib import Path

from app.storage.migrations import UnsupportedLocalDatabaseError, migrate


class LocalDatabaseResetRequiredError(RuntimeError):
    """Raised when a local database requires an explicit, user-approved reset."""


def initialize_local_database(
    root: Path,
    database_path: Path,
    enterprise_id: str | None,
) -> None:
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
            "The local TANAW database cannot be upgraded by this application. "
            f"Close TANAW and run `{_reset_command(enterprise_id)}`, then reopen the application."
        ) from exc
    finally:
        connection.close()


def _reset_command(enterprise_id: str | None) -> str:
    if enterprise_id:
        return f'npm run local-data -- clear --enterprise "{enterprise_id}" --yes'
    return "npm run local-data -- clear --full-device --yes"
