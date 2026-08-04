from typing import cast

from fastapi import APIRouter, Request, status
from starlette.responses import JSONResponse

from app.core.config import Settings
from app.features.mail.runtime import email_runtime_ready
from app.features.mail.worker import email_outbox_worker_ready
from app.features.maintenance.runtime import retention_cleanup_worker_ready
from app.features.realtime.runtime import realtime_runtime_health, realtime_runtime_ready

router = APIRouter()


def _settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


@router.get("/health")
@router.head("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready/email")
@router.head("/ready/email")
async def email_readiness(request: Request) -> JSONResponse:
    settings = _settings(request)
    ready = email_runtime_ready(settings) and email_outbox_worker_ready()
    return JSONResponse(
        status_code=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "status": "ready" if ready else "not_ready",
            "mode": settings.email_delivery_mode,
            "provider": "resend" if settings.email_delivery_mode == "resend" else "local",
        },
    )


@router.get("/ready/maintenance")
@router.head("/ready/maintenance")
async def maintenance_readiness() -> JSONResponse:
    ready = retention_cleanup_worker_ready()
    return JSONResponse(
        status_code=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"status": "ready" if ready else "not_ready"},
    )


@router.get("/ready/realtime")
@router.head("/ready/realtime")
async def realtime_readiness() -> JSONResponse:
    ready = realtime_runtime_ready()
    return JSONResponse(
        status_code=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        content=realtime_runtime_health(),
    )
