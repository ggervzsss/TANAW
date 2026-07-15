from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection

LATEST_DATABASE_REVISION = "20260715_0001"


class DatabaseSchemaError(RuntimeError):
    pass


async def validate_database_schema(connection: AsyncConnection) -> None:
    try:
        revision = await connection.scalar(text("SELECT version_num FROM alembic_version"))
    except SQLAlchemyError as exc:
        raise DatabaseSchemaError(
            "The TANAW database schema has not been initialized. "
            "Run `uv run alembic upgrade head` before starting the API."
        ) from exc

    if revision != LATEST_DATABASE_REVISION:
        raise DatabaseSchemaError(
            "The TANAW database schema version is not supported "
            f"(database={revision or 'none'}, required={LATEST_DATABASE_REVISION}). "
            "Run `uv run alembic upgrade head` before starting the API."
        )
