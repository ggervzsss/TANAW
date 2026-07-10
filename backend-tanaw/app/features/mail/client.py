from dataclasses import dataclass
from typing import Any

import httpx


class ResendAPIError(RuntimeError):
    pass


@dataclass(frozen=True)
class SentEmail:
    id: str


class ResendClient:
    def __init__(self, api_key: str, *, base_url: str, timeout_seconds: float) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds

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
            async with httpx.AsyncClient(timeout=self._timeout_seconds) as client:
                response = await client.request(
                    method,
                    f"{self._base_url}{path}",
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
            message = _resend_error_message(payload)
            raise ResendAPIError(f"Resend returned HTTP {response.status_code}: {message}")
        if not isinstance(payload, dict):
            raise ResendAPIError("Resend returned an invalid JSON response.")
        return payload


def _resend_error_message(payload: object) -> str:
    if isinstance(payload, dict):
        message = payload.get("message")
        if isinstance(message, str) and message:
            return message
        nested_error = payload.get("error")
        if isinstance(nested_error, dict):
            nested_message = nested_error.get("message")
            if isinstance(nested_message, str) and nested_message:
                return nested_message
    return "request failed"
