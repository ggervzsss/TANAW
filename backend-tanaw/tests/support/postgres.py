import os
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import Settings

TEST_DATABASE_ENV = "TANAW_TEST_DATABASE_URL"
REQUIRE_POSTGRES_ENV = "TANAW_REQUIRE_POSTGRES"


@dataclass(frozen=True)
class PostgresRuntime:
    engine: AsyncEngine
    sessions: async_sessionmaker[AsyncSession]
    settings: Settings


def postgres_test_database_url() -> str:
    raw_url = os.getenv(TEST_DATABASE_ENV)
    if not raw_url:
        if os.getenv(REQUIRE_POSTGRES_ENV) == "true":
            # The integration job sets this so a missing database fails instead of skipping.
            pytest.fail(
                f"{REQUIRE_POSTGRES_ENV}=true but {TEST_DATABASE_ENV} is not configured.",
                pytrace=False,
            )
        pytest.skip(f"{TEST_DATABASE_ENV} is not configured.")

    normalized = raw_url.strip()
    if normalized.startswith("postgres://"):
        normalized = f"postgresql://{normalized.removeprefix('postgres://')}"
    if normalized.startswith("postgresql://"):
        normalized = normalized.replace("postgresql://", "postgresql+asyncpg://", 1)
    if not normalized.startswith("postgresql+asyncpg://"):
        raise pytest.UsageError(f"{TEST_DATABASE_ENV} must point to PostgreSQL via asyncpg.")
    return normalized


@asynccontextmanager
async def open_postgres_runtime(
    clean: Callable[[PostgresRuntime], Awaitable[None]],
    **settings_overrides: Any,
) -> AsyncIterator[PostgresRuntime]:
    """Open the disposable test database with development settings plus ``settings_overrides``.

    ``clean`` removes the rows a test module creates; it runs before the module's test and again
    afterwards, so a failed run cannot leak rows into the next one. Skips the test when
    TANAW_TEST_DATABASE_URL is not configured.
    """
    database_url = postgres_test_database_url()
    engine = create_async_engine(database_url, pool_pre_ping=True)
    runtime = PostgresRuntime(
        engine=engine,
        sessions=async_sessionmaker(engine, expire_on_commit=False),
        settings=Settings(
            environment="development", database_url=database_url, **settings_overrides
        ),
    )
    try:
        await clean(runtime)
        yield runtime
    finally:
        try:
            await clean(runtime)
        finally:
            await engine.dispose()
