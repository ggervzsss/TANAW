from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse, Response

from app.api.router import api_router
from app.core.config import get_settings
from app.core.http_security import apply_security_headers
from app.db.migrations import validate_database_migration_head
from app.db.session import AsyncSessionLocal, engine
from app.features.accounts.seed import seed_default_accounts
from app.features.mail.runtime import (
    close_email_runtime,
    email_runtime_ready,
    initialize_email_runtime,
)
from app.features.mail.worker import (
    email_outbox_worker_ready,
    start_email_outbox_worker,
    stop_email_outbox_worker,
)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    async with engine.connect() as connection:
        await validate_database_migration_head(connection)

    async with AsyncSessionLocal() as session:
        await seed_default_accounts(session)

    await initialize_email_runtime(settings)
    await start_email_outbox_worker(settings)
    try:
        yield
    finally:
        await stop_email_outbox_worker()
        await close_email_runtime()


settings = get_settings()
app = FastAPI(title=settings.app_name, lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "HEAD", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.middleware("http")
async def security_headers_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    response = await call_next(request)
    apply_security_headers(request, response)
    return response


app.include_router(api_router)


@app.get("/health")
@app.head("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready/email")
@app.head("/ready/email")
async def email_readiness() -> JSONResponse:
    ready = email_runtime_ready(settings) and email_outbox_worker_ready()
    return JSONResponse(
        status_code=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "status": "ready" if ready else "not_ready",
            "mode": settings.email_delivery_mode,
            "provider": "resend" if settings.email_delivery_mode == "resend" else "local",
        },
    )
