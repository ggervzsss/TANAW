from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse, Response

from app.api.router import api_router
from app.core.client_compatibility import (
    CLIENT_COMPATIBILITY_HEADERS,
    DESKTOP_CLIENT_NAME,
    desktop_request_requires_compatibility,
    desktop_upgrade_required_response,
    is_supported_client_generation,
    request_client_generation,
)
from app.core.config import Settings, get_settings
from app.core.http_security import apply_security_headers
from app.db.migrations import validate_database_migration_head
from app.db.session import AsyncSessionLocal, engine
from app.features.accounts.seed import seed_default_accounts
from app.features.events.runtime import (
    domain_event_delivery_worker_ready,
    start_domain_event_delivery_worker,
    stop_domain_event_delivery_worker,
)
from app.features.final_reports.artifact_runtime import (
    final_report_artifact_worker_ready,
    start_final_report_artifact_worker,
    stop_final_report_artifact_worker,
)
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
from app.features.maintenance.runtime import (
    retention_cleanup_worker_ready,
    start_retention_cleanup_worker,
    stop_retention_cleanup_worker,
)


@dataclass(frozen=True, slots=True)
class BackgroundRuntime:
    name: str
    start: Callable[[Settings], Awaitable[None]]
    stop: Callable[[], Awaitable[None]]


TARGET_BACKGROUND_RUNTIMES = (
    BackgroundRuntime(
        name="email_outbox",
        start=start_email_outbox_worker,
        stop=stop_email_outbox_worker,
    ),
    BackgroundRuntime(
        name="final_report_artifacts",
        start=start_final_report_artifact_worker,
        stop=stop_final_report_artifact_worker,
    ),
    BackgroundRuntime(
        name="retention_cleanup",
        start=start_retention_cleanup_worker,
        stop=stop_retention_cleanup_worker,
    ),
    BackgroundRuntime(
        name="domain_event_delivery_and_realtime_subscription",
        start=start_domain_event_delivery_worker,
        stop=stop_domain_event_delivery_worker,
    ),
)


@asynccontextmanager
async def _background_runtimes() -> AsyncIterator[None]:
    async with AsyncExitStack() as runtimes:
        runtimes.push_async_callback(close_email_runtime)
        await initialize_email_runtime(settings)
        for runtime in TARGET_BACKGROUND_RUNTIMES:
            runtimes.push_async_callback(runtime.stop)
            await runtime.start(settings)
        yield


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    async with engine.connect() as connection:
        await validate_database_migration_head(connection)

    async with AsyncSessionLocal() as session:
        await seed_default_accounts(session)

    async with _background_runtimes():
        yield


settings = get_settings()
app = FastAPI(title=settings.app_name, lifespan=lifespan)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", *CLIENT_COMPATIBILITY_HEADERS],
    expose_headers=["ETag"],
)


@app.middleware("http")
async def security_headers_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    response: Response
    if desktop_request_requires_compatibility(request) and not is_supported_client_generation(
        request_client_generation(request),
        settings,
        allowed_client_names=frozenset({DESKTOP_CLIENT_NAME}),
    ):
        response = desktop_upgrade_required_response(settings)
    else:
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


@app.get("/ready/maintenance")
@app.head("/ready/maintenance")
async def maintenance_readiness() -> JSONResponse:
    ready = retention_cleanup_worker_ready()
    return JSONResponse(
        status_code=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"status": "ready" if ready else "not_ready"},
    )


@app.get("/ready/domain-events")
@app.head("/ready/domain-events")
async def domain_event_readiness() -> JSONResponse:
    ready = domain_event_delivery_worker_ready()
    return JSONResponse(
        status_code=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"status": "ready" if ready else "not_ready"},
    )


@app.get("/ready/final-report-artifacts")
@app.head("/ready/final-report-artifacts")
async def final_report_artifact_readiness() -> JSONResponse:
    ready = final_report_artifact_worker_ready()
    return JSONResponse(
        status_code=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"status": "ready" if ready else "not_ready"},
    )
