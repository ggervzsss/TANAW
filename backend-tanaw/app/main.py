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
from app.features.mail.service import EmailDeliveryError


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    async with engine.connect() as connection:
        await validate_database_migration_head(connection)

    async with AsyncSessionLocal() as session:
        await seed_default_accounts(session)

    yield


settings = get_settings()
app = FastAPI(title=settings.app_name, lifespan=lifespan)


@app.exception_handler(EmailDeliveryError)
async def email_delivery_error_handler(_: Request, __: EmailDeliveryError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={
            "detail": "TANAW could not deliver the email. Verify the email configuration and try again."
        },
    )


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
