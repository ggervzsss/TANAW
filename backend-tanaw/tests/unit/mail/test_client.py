import json
from uuid import UUID

import httpx
import pytest

from app.features.mail.client import BrevoAPIError, BrevoClient


@pytest.mark.asyncio
async def test_brevo_client_reuses_connection_pool_and_maps_messages() -> None:
    request_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        assert request.url == "https://api.brevo.com/v3/smtp/email"
        assert request.headers["api-key"] == "xkeysib-test_sending_key_123456789"
        assert request.headers["user-agent"] == "TANAW/1.0"
        payload = json.loads(request.content)
        assert payload["sender"] == {
            "name": "TANAW",
            "email": "no-reply@example.com",
        }
        assert payload["to"] == [{"email": f"recipient-{request_count}@example.com"}]
        assert payload["htmlContent"] == f"<p>Message {request_count}</p>"
        assert payload["textContent"] == f"Message {request_count}"
        assert payload["tags"] == ["category:authentication", "purpose:test"]
        UUID(payload["headers"]["idempotencyKey"])
        return httpx.Response(201, json={"messageId": f"email-{request_count}"})

    client = BrevoClient(
        "xkeysib-test_sending_key_123456789",
        base_url="https://api.brevo.com/v3",
        timeout_seconds=10,
        transport=httpx.MockTransport(handler),
    )
    try:
        sent = []
        for number in (1, 2):
            sent.append(
                await client.send_email(
                    sender="TANAW <no-reply@example.com>",
                    recipient=f"recipient-{number}@example.com",
                    subject=f"Message {number}",
                    text=f"Message {number}",
                    html=f"<p>Message {number}</p>",
                    idempotency_key=f"message-{number}",
                    tags={"purpose": "test", "category": "authentication"},
                )
            )
    finally:
        await client.aclose()

    assert [message.id for message in sent] == ["email-1", "email-2"]
    assert request_count == 2


@pytest.mark.asyncio
async def test_brevo_error_classifies_retry_and_redacts_api_key() -> None:
    api_key = "xkeysib-secret_sending_key_123456789"

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            headers={"retry-after": "2.5"},
            json={
                "code": "rate_limit",
                "message": f"Retry request authenticated with {api_key}",
            },
        )

    client = BrevoClient(
        api_key,
        base_url="https://api.brevo.com/v3",
        timeout_seconds=10,
        transport=httpx.MockTransport(handler),
    )
    try:
        with pytest.raises(BrevoAPIError) as captured:
            await client.send_email(
                sender="TANAW <no-reply@example.com>",
                recipient="recipient@example.com",
                subject="Test",
                text="Test",
                html="<p>Test</p>",
                idempotency_key="rate-limited-message",
            )
    finally:
        await client.aclose()

    error = captured.value
    assert error.retryable is True
    assert error.status_code == 429
    assert error.error_type == "rate_limit"
    assert error.retry_after_seconds == 2.5
    assert api_key not in str(error)


def test_brevo_duplicate_error_requires_provider_reconciliation() -> None:
    error = BrevoAPIError(
        "Brevo rejected a duplicate idempotency key.",
        status_code=400,
        error_type="duplicate_parameter",
    )

    assert error.retryable is False
    assert error.duplicate is True
