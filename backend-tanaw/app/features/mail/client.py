import re
from dataclasses import dataclass
from typing import Any

import httpx


class ResendAPIError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        status_code: int | None = None,
        error_type: str | None = None,
        retry_after_seconds: float | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.error_type = error_type
        self.retry_after_seconds = retry_after_seconds

    @property
    def retryable(self) -> bool:
        return (
            self.status_code is None
            or self.status_code == 408
            or self.status_code == 429
            or (self.status_code is not None and self.status_code >= 500)
            or self.error_type == "concurrent_idempotent_requests"
        )


@dataclass(frozen=True)
class SentEmail:
    id: str


class ResendClient:
    def __init__(
        self,
        api_key: str,
        *,
        base_url: str,
        timeout_seconds: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._api_key = api_key
        short_timeout = min(timeout_seconds, 5.0)
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(
                connect=short_timeout,
                read=timeout_seconds,
                write=timeout_seconds,
                pool=short_timeout,
            ),
            limits=httpx.Limits(
                max_connections=10,
                max_keepalive_connections=5,
                keepalive_expiry=30.0,
            ),
            headers={"User-Agent": "TANAW/1.0"},
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def send_email(
        self,
        *,
        sender: str,
        recipient: str,
        subject: str,
        text: str,
        html: str,
        idempotency_key: str,
        tags: dict[str, str] | None = None,
    ) -> SentEmail:
        payload: dict[str, Any] = {
            "from": sender,
            "to": [recipient],
            "subject": subject,
            "text": text,
            "html": html,
        }
        if tags:
            payload["tags"] = [{"name": name, "value": value} for name, value in tags.items()]

        response = await self._request(
            "POST",
            "/emails",
            json=payload,
            headers={"Idempotency-Key": idempotency_key},
        )
        message_id = response.get("id")
        if not isinstance(message_id, str) or not message_id:
            raise ResendAPIError("Resend returned an invalid send response.")
        return SentEmail(id=message_id)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        request_headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            **(headers or {}),
        }
        try:
            response = await self._client.request(
                method,
                path,
                json=json,
                headers=request_headers,
            )
        except httpx.HTTPError as exc:
            raise ResendAPIError("Resend could not be reached.") from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise ResendAPIError(f"Resend returned HTTP {response.status_code}.") from exc
        if response.is_error:
            error_type, message = _resend_error_details(payload)
            raise ResendAPIError(
                f"Resend returned HTTP {response.status_code}: "
                f"{_redact_api_keys(message, self._api_key)}",
                status_code=response.status_code,
                error_type=error_type,
                retry_after_seconds=_retry_after_seconds(response),
            )
        if not isinstance(payload, dict):
            raise ResendAPIError("Resend returned an invalid JSON response.")
        return payload


def _resend_error_details(payload: object) -> tuple[str | None, str]:
    if isinstance(payload, dict):
        error_type = payload.get("name") or payload.get("type")
        normalized_type = error_type if isinstance(error_type, str) else None
        message = payload.get("message")
        if isinstance(message, str) and message:
            return normalized_type, message
        nested_error = payload.get("error")
        if isinstance(nested_error, dict):
            nested_type = nested_error.get("name") or nested_error.get("type")
            if isinstance(nested_type, str):
                normalized_type = nested_type
            nested_message = nested_error.get("message")
            if isinstance(nested_message, str) and nested_message:
                return normalized_type, nested_message
        return normalized_type, "request failed"
    return None, "request failed"


def _retry_after_seconds(response: httpx.Response) -> float | None:
    value = response.headers.get("retry-after")
    if value is None:
        return None
    try:
        return max(0.0, float(value))
    except ValueError:
        return None


def _redact_api_keys(message: str, configured_key: str) -> str:
    redacted = message.replace(configured_key, "[redacted]")
    return re.sub(r"\bre_[A-Za-z0-9_-]{8,}\b", "[redacted]", redacted)
