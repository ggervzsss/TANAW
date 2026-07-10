from fastapi.testclient import TestClient

from app.main import app


def test_health_endpoint_reports_ok() -> None:
    client = TestClient(app)

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert "strict-transport-security" not in response.headers


def test_health_endpoint_allows_head_checks() -> None:
    client = TestClient(app)

    response = client.head("/health")

    assert response.status_code == 200
    assert response.content == b""


def test_hsts_header_is_set_for_https_non_local_requests() -> None:
    client = TestClient(app, base_url="https://tanaw.onrender.com")

    response = client.get("/health")

    assert response.status_code == 200
    assert (
        response.headers["strict-transport-security"]
        == "max-age=31536000; includeSubDomains; preload"
    )


def test_auth_routes_are_not_cached() -> None:
    client = TestClient(app)

    response = client.get("/auth/system-settings")

    assert response.status_code == 401
    assert response.headers["cache-control"] == "no-cache, no-store, must-revalidate, private"
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["expires"] == "0"
