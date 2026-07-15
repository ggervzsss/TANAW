from typing import cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import WebSocket
from fastapi.testclient import TestClient

from app.core.client_compatibility import (
    CLIENT_NAME_HEADER,
    CLIENT_VERSION_HEADER,
    CONTRACT_VERSION_HEADER,
    DESKTOP_CLIENT_NAME,
    MANDATORY_UPGRADE_REASON,
    MANDATORY_UPGRADE_WEBSOCKET_CODE,
    PORTAL_CLIENT_NAME,
    RELEASE_ID_HEADER,
    ClientGeneration,
    is_supported_client_generation,
    reject_unsupported_websocket_generation,
)
from app.core.config import Settings
from app.main import app

SUPPORTED_HEADERS = {
    CLIENT_NAME_HEADER: DESKTOP_CLIENT_NAME,
    CLIENT_VERSION_HEADER: "2.0.0",
    CONTRACT_VERSION_HEADER: "2",
    RELEASE_ID_HEADER: "tanaw-release-2",
}


@pytest.mark.parametrize(
    ("generation", "supported"),
    [
        (ClientGeneration("enterprise-desktop", "2.0.0", "2", "tanaw-release-2"), True),
        (ClientGeneration("enterprise-desktop", "2.99.99", "2", "tanaw-release-2"), True),
        (ClientGeneration("enterprise-desktop", "0.0.0", "2", "tanaw-release-2"), False),
        (ClientGeneration("enterprise-desktop", "1.9.9", "2", "tanaw-release-2"), False),
        (ClientGeneration("enterprise-desktop", "3.0.0", "2", "tanaw-release-2"), False),
        (ClientGeneration("enterprise-desktop", "2.0.0", "1", "tanaw-release-2"), False),
        (ClientGeneration("enterprise-desktop", "2.0.0", "2", "another-release"), False),
        (ClientGeneration("unknown-client", "2.0.0", "2", "tanaw-release-2"), False),
        (ClientGeneration(None, None, None, None), False),
    ],
)
def test_supported_client_generation_is_exact(
    generation: ClientGeneration, supported: bool
) -> None:
    assert is_supported_client_generation(generation, Settings()) is supported


def test_outdated_desktop_is_rejected_before_business_body_parsing() -> None:
    client = TestClient(app)

    response = client.post(
        "/operational/desktop/report-submissions/v2",
        content=b"{not-json",
        headers={"Content-Type": "application/json"},
    )

    assert response.status_code == 426
    assert response.json() == {
        "contractVersion": 2,
        "error": {
            "code": "CLIENT_UPGRADE_REQUIRED",
            "message": "Update TANAW to the required release before continuing.",
            "retryable": False,
            "minimumClientVersion": "2.0.0",
            "requiredContractVersion": 2,
        },
    }


def test_supported_desktop_generation_is_accepted() -> None:
    client = TestClient(app)

    response = client.post(
        "/operational/desktop/report-submissions/v2",
        content=b"{not-json",
        headers={"Content-Type": "application/json", **SUPPORTED_HEADERS},
    )

    assert response.status_code != 426


def test_production_portal_generation_is_required_for_general_api_reads(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import main as app_main

    production_settings = Settings().model_copy(update={"environment": "production"})
    monkeypatch.setattr(app_main, "settings", production_settings)
    client = TestClient(app)

    missing = client.get("/auth/me")
    supported = client.get(
        "/auth/me",
        headers={
            CLIENT_NAME_HEADER: PORTAL_CLIENT_NAME,
            CLIENT_VERSION_HEADER: "2.0.0",
            CONTRACT_VERSION_HEADER: "2",
            RELEASE_ID_HEADER: "tanaw-release-2",
        },
    )
    health = client.get("/health")

    assert missing.status_code == 426
    assert supported.status_code != 426
    assert health.status_code == 200


@pytest.mark.asyncio
async def test_outdated_websocket_receives_distinct_mandatory_upgrade_close() -> None:
    websocket = MagicMock()
    websocket.close = AsyncMock()

    rejected = await reject_unsupported_websocket_generation(
        cast(WebSocket, websocket),
        ClientGeneration("enterprise-desktop", "0.0.0", "1", "old-release"),
        Settings(),
    )

    assert rejected is True
    websocket.close.assert_awaited_once_with(
        code=MANDATORY_UPGRADE_WEBSOCKET_CODE,
        reason=MANDATORY_UPGRADE_REASON,
    )
