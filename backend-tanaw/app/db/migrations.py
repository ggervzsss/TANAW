from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection

LATEST_DATABASE_REVISION = "20260714_0033"


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

    if revision != LATEST_DATABASE_REVISION:
        raise DatabaseMigrationError(
            "The TANAW database migration is out of date "
            f"(database={revision or 'none'}, required={LATEST_DATABASE_REVISION}). "
            "Run `uv run alembic upgrade head` before starting the API."
        )
