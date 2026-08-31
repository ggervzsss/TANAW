import hashlib
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection

CANONICAL_DATABASE_REVISION = "0001"
CANONICAL_BASELINE_PATH = (
    Path(__file__).resolve().parents[2] / "alembic" / "versions" / "0001_initial_tanaw_schema.py"
)


class DatabaseMigrationError(RuntimeError):
    pass


async def validate_database_migration_head(connection: AsyncConnection) -> None:
    try:
        revision = await connection.scalar(text("SELECT version_num FROM alembic_version"))
    except SQLAlchemyError as exc:
        raise DatabaseMigrationError(
            "The TANAW database has not been initialized by Alembic. "
            "Run `uv run alembic upgrade head` before starting the API."
        ) from exc

    if revision != CANONICAL_DATABASE_REVISION:
        raise DatabaseMigrationError(
            "The TANAW database migration is out of date "
            f"(database={revision or 'none'}, required={CANONICAL_DATABASE_REVISION}). "
            "Recreate the database and run `uv run alembic upgrade head`."
        )

    try:
        schema_fingerprint = await connection.scalar(
            text("SELECT schema_fingerprint FROM tanaw_schema_identity WHERE singleton_id = 1")
        )
    except SQLAlchemyError as exc:
        raise DatabaseMigrationError(
            "The TANAW database does not match the current canonical schema. "
            "Recreate the database and run `uv run alembic upgrade head`."
        ) from exc

    expected_fingerprint = canonical_schema_fingerprint()
    if schema_fingerprint != expected_fingerprint:
        raise DatabaseMigrationError(
            "The TANAW database does not match the current canonical schema "
            f"(database={schema_fingerprint or 'none'}, required={expected_fingerprint}). "
            "Recreate the database and run `uv run alembic upgrade head`."
        )


def canonical_schema_fingerprint() -> str:
    return hashlib.sha256(CANONICAL_BASELINE_PATH.read_bytes()).hexdigest()
