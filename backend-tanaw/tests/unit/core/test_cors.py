from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

TRUSTED_FRONTEND_ORIGIN = "https://tanaw-sanpedro.vercel.app"
EVIL_ORIGIN = "https://evil.example"
# The installed desktop serves its renderer from this custom scheme.
DESKTOP_ORIGIN = "tanaw-app://desktop"
BACKUP_PATH = "/operational/desktop/backup"
PRODUCTION_JWT_SECRET = "production-jwt-secret-with-at-least-32-characters"
PRODUCTION_EMAIL_SETTINGS: dict[str, Any] = {
    "email_delivery_mode": "brevo",
    "brevo_api_key": "xkeysib-production_sending_key_123456789",
    "email_secret_derivation_key": "production-email-secret-different-from-jwt-2026",
    "email_from_address": "no-reply@mail.tanaw-sanpedro.ph",
}


def build_cors_test_client() -> TestClient:
    """A client for the application's own CORS middleware, as ``create_app`` configures it."""
    settings = Settings(
        environment="production",
        cors_origins=f"{TRUSTED_FRONTEND_ORIGIN},{DESKTOP_ORIGIN}",
        frontend_public_url=TRUSTED_FRONTEND_ORIGIN,
        jwt_secret_key=PRODUCTION_JWT_SECRET,
        **PRODUCTION_EMAIL_SETTINGS,
    )
    # The client is not entered as a context manager, so the lifespan (database,
    # workers) does not start; only the middleware stack and routes are exercised.
    return TestClient(create_app(settings=settings), base_url="https://tanaw.onrender.com")


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


@pytest.mark.parametrize("origin", [TRUSTED_FRONTEND_ORIGIN, DESKTOP_ORIGIN])
def test_put_preflight_for_desktop_backup_is_allowed(origin: str) -> None:
    client = build_cors_test_client()

    response = client.options(
        BACKUP_PATH,
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )

    assert response.status_code == 200, response.text
    assert response.headers["access-control-allow-origin"] == origin
    assert "PUT" in response.headers["access-control-allow-methods"]
    assert response.headers["access-control-allow-credentials"] == "true"


def test_put_preflight_rejects_unknown_origin() -> None:
    client = build_cors_test_client()

    response = client.options(
        BACKUP_PATH,
        headers={"Origin": EVIL_ORIGIN, "Access-Control-Request-Method": "PUT"},
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_every_mounted_route_method_passes_cors_preflight() -> None:
    """A route whose method CORS does not allow fails in browsers but passes server tests."""
    client = build_cors_test_client()
    methods = {
        method
        for route in client.app.routes  # type: ignore[attr-defined]
        for method in getattr(route, "methods", None) or ()
    } - {"HEAD", "OPTIONS"}

    for method in sorted(methods):
        response = client.options(
            BACKUP_PATH,
            headers={"Origin": DESKTOP_ORIGIN, "Access-Control-Request-Method": method},
        )
        assert response.status_code == 200, f"{method}: {response.text}"
