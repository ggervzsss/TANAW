import httpx
import pytest

from app.features.mail.client import ResendAPIError, ResendClient


@pytest.mark.asyncio
async def test_resend_client_reuses_connection_pool_for_multiple_messages() -> None:
    request_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal request_count
        request_count += 1
        assert request.headers["authorization"] == "Bearer re_test_sending_key_123456789"
        assert request.headers["user-agent"] == "TANAW/1.0"
        return httpx.Response(200, json={"id": f"email-{request_count}"})

    client = ResendClient(
        "re_test_sending_key_123456789",
        base_url="https://api.resend.com",
        timeout_seconds=10,
        transport=httpx.MockTransport(handler),
    )
    try:
        first = await client.send_email(
            sender="TANAW <no-reply@example.com>",
            recipient="first@example.com",
            subject="First",
            text="First",
            html="<p>First</p>",
            idempotency_key="first-message",
        )
        second = await client.send_email(
            sender="TANAW <no-reply@example.com>",
            recipient="second@example.com",
            subject="Second",
            text="Second",
            html="<p>Second</p>",
            idempotency_key="second-message",
        )
    finally:
        await client.aclose()

    assert (first.id, second.id) == ("email-1", "email-2")
    assert request_count == 2


@pytest.mark.asyncio
async def test_resend_error_classifies_retry_and_redacts_api_key() -> None:
    api_key = "re_secret_sending_key_123456789"

    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            headers={"retry-after": "2.5"},
            json={
                "name": "rate_limit_exceeded",
                "message": f"Retry request authenticated with {api_key}",
            },
        )

    client = ResendClient(
        api_key,
        base_url="https://api.resend.com",
        timeout_seconds=10,
        transport=httpx.MockTransport(handler),
    )
    try:
        with pytest.raises(ResendAPIError) as captured:
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
    assert error.error_type == "rate_limit_exceeded"
    assert error.retry_after_seconds == 2.5
    assert api_key not in str(error)
