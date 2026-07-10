from dataclasses import dataclass
from typing import Any

import httpx


class ResendAPIError(RuntimeError):
    pass


@dataclass(frozen=True)
class SentEmail:
    id: str


@dataclass(frozen=True)
class ReceivedEmail:
    id: str
    sender: str
    recipients: tuple[str, ...]
    subject: str
    text: str | None
    html: str | None
    message_id: str | None
    headers: dict[str, str]
    attachment_count: int


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
        reply_to: str | None,
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
        if reply_to:
            payload["reply_to"] = reply_to
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

    async def get_received_email(self, email_id: str) -> ReceivedEmail:
        response = await self._request("GET", f"/emails/receiving/{email_id}")
        sender = response.get("from")
        recipients = response.get("to")
        subject = response.get("subject")
        if not isinstance(sender, str) or not isinstance(recipients, list):
            raise ResendAPIError("Resend returned invalid received-email metadata.")
        headers = response.get("headers")
        attachments = response.get("attachments")
        return ReceivedEmail(
            id=str(response.get("id") or email_id),
            sender=sender,
            recipients=tuple(item for item in recipients if isinstance(item, str)),
            subject=subject if isinstance(subject, str) else "(No subject)",
            text=response.get("text") if isinstance(response.get("text"), str) else None,
            html=response.get("html") if isinstance(response.get("html"), str) else None,
            message_id=(
                response.get("message_id") if isinstance(response.get("message_id"), str) else None
            ),
            headers={
                key.lower(): value
                for key, value in (headers.items() if isinstance(headers, dict) else ())
                if isinstance(key, str) and isinstance(value, str)
            },
            attachment_count=len(attachments) if isinstance(attachments, list) else 0,
        )

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
