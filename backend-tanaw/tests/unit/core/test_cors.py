from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.testclient import TestClient

from app.core.config import Settings

TRUSTED_FRONTEND_ORIGIN = "https://tanaw-sanpedro.vercel.app"
EVIL_ORIGIN = "https://evil.example"
PRODUCTION_JWT_SECRET = "production-jwt-secret-with-at-least-32-characters"
PRODUCTION_EMAIL_SETTINGS: dict[str, Any] = {
    "email_delivery_mode": "brevo",
    "brevo_api_key": "xkeysib-production_sending_key_123456789",
    "email_secret_derivation_key": "production-email-secret-different-from-jwt-2026",
    "email_from_address": "no-reply@mail.tanaw-sanpedro.ph",
}


def build_cors_test_client() -> TestClient:
    settings = Settings(
        environment="production",
        cors_origins=TRUSTED_FRONTEND_ORIGIN,
        frontend_public_url=TRUSTED_FRONTEND_ORIGIN,
        jwt_secret_key=PRODUCTION_JWT_SECRET,
        **PRODUCTION_EMAIL_SETTINGS,
    )
    app = FastAPI()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    return TestClient(app, base_url="https://tanaw.onrender.com")


def test_trusted_production_origin_receives_cors_header() -> None:
    client = build_cors_test_client()

    response = client.get("/health", headers={"Origin": TRUSTED_FRONTEND_ORIGIN})

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == TRUSTED_FRONTEND_ORIGIN
    assert response.headers["access-control-allow-origin"] != "*"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_unknown_origin_does_not_receive_cors_header() -> None:
    client = build_cors_test_client()

    response = client.get("/health", headers={"Origin": EVIL_ORIGIN})

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers
    assert response.headers["access-control-allow-credentials"] == "true"


def test_options_preflight_works_for_trusted_origin() -> None:
    client = build_cors_test_client()

    response = client.options(
        "/health",
        headers={
            "Origin": TRUSTED_FRONTEND_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == TRUSTED_FRONTEND_ORIGIN
    assert response.headers["access-control-allow-origin"] != "*"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_options_preflight_rejects_unknown_origin() -> None:
    client = build_cors_test_client()

    response = client.options(
        "/health",
        headers={
            "Origin": EVIL_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,authorization",
        },
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_delete_preflight_works_for_trusted_origin() -> None:
    client = build_cors_test_client()

    response = client.options(
        "/health",
        headers={
            "Origin": TRUSTED_FRONTEND_ORIGIN,
            "Access-Control-Request-Method": "DELETE",
            "Access-Control-Request-Headers": "authorization",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == TRUSTED_FRONTEND_ORIGIN
    assert "DELETE" in response.headers["access-control-allow-methods"]
