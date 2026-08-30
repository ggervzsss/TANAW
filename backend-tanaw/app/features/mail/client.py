import re
from dataclasses import dataclass
from email.utils import parseaddr
from typing import Any
from uuid import NAMESPACE_URL, uuid5

import httpx


class BrevoAPIError(RuntimeError):
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
        )

    @property
    def duplicate(self) -> bool:
        return self.error_type == "duplicate_parameter"


@dataclass(frozen=True)
class SentEmail:
    id: str


class BrevoClient:
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
        sender_name, sender_address = parseaddr(sender)
        if not sender_address:
            raise BrevoAPIError("TANAW has an invalid Brevo sender address.")

        payload: dict[str, Any] = {
            "sender": {"name": sender_name, "email": sender_address},
            "to": [{"email": recipient}],
            "subject": subject,
            "textContent": text,
            "htmlContent": html,
            "headers": {"idempotencyKey": _brevo_idempotency_key(idempotency_key)},
        }
        if tags:
            payload["tags"] = [f"{name}:{value}" for name, value in sorted(tags.items())]

        response = await self._request("POST", "/smtp/email", json=payload)
        message_id = response.get("messageId")
        if not isinstance(message_id, str) or not message_id:
            raise BrevoAPIError("Brevo returned an invalid send response.")
        return SentEmail(id=message_id)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        request_headers = {
            "accept": "application/json",
            "api-key": self._api_key,
            "Content-Type": "application/json",
        }
        try:
            response = await self._client.request(
                method,
                path,
                json=json,
                headers=request_headers,
            )
        except httpx.HTTPError as exc:
            raise BrevoAPIError("Brevo could not be reached.") from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise BrevoAPIError(f"Brevo returned HTTP {response.status_code}.") from exc
        if response.is_error:
            error_type, message = _brevo_error_details(payload)
            raise BrevoAPIError(
                f"Brevo returned HTTP {response.status_code}: "
                f"{_redact_api_keys(message, self._api_key)}",
                status_code=response.status_code,
                error_type=error_type,
                retry_after_seconds=_retry_after_seconds(response),
            )
        if not isinstance(payload, dict):
            raise BrevoAPIError("Brevo returned an invalid JSON response.")
        return payload


def _brevo_idempotency_key(value: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"https://tanaw.local/email/{value}"))


def _brevo_error_details(payload: object) -> tuple[str | None, str]:
    if isinstance(payload, dict):
        error_type = payload.get("code")
        normalized_type = error_type if isinstance(error_type, str) else None
        message = payload.get("message")
        if isinstance(message, str) and message:
            return normalized_type, message
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
    return re.sub(r"\bxkeysib-[A-Za-z0-9_-]{8,}\b", "[redacted]", redacted)
