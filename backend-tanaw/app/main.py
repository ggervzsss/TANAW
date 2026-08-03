from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from starlette.responses import Response

from app.api.router import api_router
from app.api.system_router import router as system_router
from app.core.config import Settings, get_settings
from app.core.http_security import apply_security_headers
from app.db.migrations import validate_database_migration_head
from app.db.session import AsyncSessionLocal, engine
from app.features.accounts.seed import seed_default_accounts
from app.features.mail.runtime import close_email_runtime, initialize_email_runtime
from app.features.mail.worker import start_email_outbox_worker, stop_email_outbox_worker
from app.features.maintenance.runtime import (
    start_retention_cleanup_worker,
    stop_retention_cleanup_worker,
)
from app.features.realtime.runtime import start_realtime_runtime, stop_realtime_runtime


def create_lifespan(
    settings: Settings,
    database_engine: AsyncEngine,
    session_factory: async_sessionmaker[AsyncSession],
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        async with database_engine.connect() as connection:
            await validate_database_migration_head(connection)

        async with session_factory() as session:
            await seed_default_accounts(session)

        await initialize_email_runtime(settings)
        await start_email_outbox_worker(settings)
        await start_retention_cleanup_worker(settings)
        await start_realtime_runtime(settings)
        try:
            yield
        finally:
            await stop_realtime_runtime()
            await stop_retention_cleanup_worker()
            await stop_email_outbox_worker()
            await close_email_runtime()

    return lifespan


def create_app(
    *,
    settings: Settings | None = None,
    database_engine: AsyncEngine = engine,
    session_factory: async_sessionmaker[AsyncSession] = AsyncSessionLocal,
) -> FastAPI:
    resolved_settings = settings or get_settings()
    application = FastAPI(
        title=resolved_settings.app_name,
        lifespan=create_lifespan(resolved_settings, database_engine, session_factory),
    )
    application.state.settings = resolved_settings
    application.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @application.middleware("http")
    async def security_headers_middleware(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)
        apply_security_headers(request, response)
        return response

    application.include_router(system_router)
    application.include_router(api_router)
    return application


app = create_app()
