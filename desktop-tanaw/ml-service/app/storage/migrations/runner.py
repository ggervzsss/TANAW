import re
import sqlite3
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from app.storage.migrations.revisions import revision_001_initial_schema

MIGRATION_TABLE = "schema_migrations"
_MIGRATION_TABLE_COLUMNS = frozenset({"revision", "checksum", "applied_at"})


class UnsupportedLocalDatabaseError(RuntimeError):
    """Raised when a database cannot be upgraded by the known linear history."""


@dataclass(frozen=True)
class Migration:
    revision: str
    name: str
    previous_revision: str | None
    checksum: str
    upgrade: Callable[[sqlite3.Connection], None]

    @property
    def label(self) -> str:
        return f"{self.revision}_{self.name}"


@dataclass(frozen=True)
class MigrationStatus:
    current_revision: str | None
    latest_revision: str
    applied_revisions: tuple[str, ...]
    pending_revisions: tuple[str, ...]
    error: str | None = None

    @property
    def is_supported(self) -> bool:
        return self.error is None


DEFAULT_MIGRATIONS = (
    Migration(
        revision=revision_001_initial_schema.REVISION,
        name=revision_001_initial_schema.NAME,
        previous_revision=revision_001_initial_schema.PREVIOUS_REVISION,
        checksum=revision_001_initial_schema.CHECKSUM,
        upgrade=revision_001_initial_schema.upgrade,
    ),
)
LATEST_REVISION = DEFAULT_MIGRATIONS[-1].revision


def migrate(
    connection: sqlite3.Connection,
    migrations: Sequence[Migration] = DEFAULT_MIGRATIONS,
) -> MigrationStatus:
    ordered = _ordered_migrations(migrations)
    if connection.in_transaction:
        raise RuntimeError("SQLite migrations require a connection without an active transaction")

    _ensure_migration_table(connection)
    while True:
        connection.execute("begin immediate")
        try:
            status = migration_status(connection, ordered)
            if status.error is not None:
                raise UnsupportedLocalDatabaseError(status.error)
            if not status.pending_revisions:
                connection.commit()
                return status

            next_revision = status.pending_revisions[0]
            migration = next(item for item in ordered if item.revision == next_revision)
            migration.upgrade(connection)
            connection.execute(
                "insert into schema_migrations (revision, checksum) values (?, ?)",
                (migration.revision, migration.checksum),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise


def migration_status(
    connection: sqlite3.Connection,
    migrations: Sequence[Migration] = DEFAULT_MIGRATIONS,
) -> MigrationStatus:
    ordered = _ordered_migrations(migrations)
    known_revisions = tuple(migration.revision for migration in ordered)
    known_checksums = {migration.revision: migration.checksum for migration in ordered}
    tables = _application_tables(connection)

    if MIGRATION_TABLE not in tables:
        error = None
        if tables:
            error = "The local TANAW database has application tables but no migration history."
        return MigrationStatus(
            current_revision=None,
            latest_revision=known_revisions[-1],
            applied_revisions=(),
            pending_revisions=known_revisions if error is None else (),
            error=error,
        )

    columns = {str(row[1]) for row in connection.execute(f"pragma table_info({MIGRATION_TABLE})")}
    if not _MIGRATION_TABLE_COLUMNS.issubset(columns):
        return MigrationStatus(
            current_revision=None,
            latest_revision=known_revisions[-1],
            applied_revisions=(),
            pending_revisions=(),
            error="The local TANAW database has an unsupported migration tracking table.",
        )

    rows = connection.execute(
        "select revision, checksum from schema_migrations order by revision"
    ).fetchall()
    applied_revisions = tuple(str(row[0]) for row in rows)
    current_revision = applied_revisions[-1] if applied_revisions else None
    expected_prefix = known_revisions[: len(applied_revisions)]
    if applied_revisions != expected_prefix:
        return MigrationStatus(
            current_revision=current_revision,
            latest_revision=known_revisions[-1],
            applied_revisions=applied_revisions,
            pending_revisions=(),
            error=(
                f"Database revision {current_revision or 'none'} is not supported; "
                f"the latest revision understood by this application is {known_revisions[-1]}."
            ),
        )

    for revision, checksum in rows:
        if str(checksum) != known_checksums[str(revision)]:
            return MigrationStatus(
                current_revision=current_revision,
                latest_revision=known_revisions[-1],
                applied_revisions=applied_revisions,
                pending_revisions=(),
                error=f"Database migration {revision} does not match the current baseline.",
            )

    application_tables = tables - {MIGRATION_TABLE}
    if not applied_revisions and application_tables:
        return MigrationStatus(
            current_revision=None,
            latest_revision=known_revisions[-1],
            applied_revisions=(),
            pending_revisions=(),
            error="The local TANAW database has untracked application tables.",
        )

    return MigrationStatus(
        current_revision=current_revision,
        latest_revision=known_revisions[-1],
        applied_revisions=applied_revisions,
        pending_revisions=known_revisions[len(applied_revisions) :],
    )


def _ensure_migration_table(connection: sqlite3.Connection) -> None:
    connection.execute("begin immediate")
    try:
        tables = _application_tables(connection)
        if MIGRATION_TABLE not in tables and tables:
            raise UnsupportedLocalDatabaseError(
                "The local TANAW database has no supported migration history."
            )
        connection.execute(
            """
            create table if not exists schema_migrations (
                revision text primary key,
                checksum text not null,
                applied_at text not null default (
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                )
            )
            """
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def _application_tables(connection: sqlite3.Connection) -> set[str]:
    return {
        str(row[0])
        for row in connection.execute("select name from sqlite_master where type = 'table'")
        if not str(row[0]).startswith("sqlite_")
    }


def _ordered_migrations(migrations: Sequence[Migration]) -> tuple[Migration, ...]:
    ordered = tuple(sorted(migrations, key=lambda migration: migration.revision))
    if not ordered:
        raise ValueError("at least one SQLite migration is required")

    seen: set[str] = set()
    previous_revision: str | None = None
    for migration in ordered:
        if re.fullmatch(r"\d{3}", migration.revision) is None:
            raise ValueError(f"invalid SQLite migration revision: {migration.revision}")
        if migration.revision in seen:
            raise ValueError(f"duplicate SQLite migration revision: {migration.revision}")
        if migration.previous_revision != previous_revision:
            raise ValueError(
                f"migration {migration.label} must follow {previous_revision or 'the baseline'}"
            )
        seen.add(migration.revision)
        previous_revision = migration.revision
    return ordered
