from app.core.config import Settings
from app.features.mail.client import ResendClient

_resend_client: ResendClient | None = None


async def initialize_email_runtime(settings: Settings) -> None:
    global _resend_client
    await close_email_runtime()
    if settings.email_delivery_mode != "resend":
        return
    if settings.resend_api_key is None:
        return
    _resend_client = ResendClient(
        settings.resend_api_key.get_secret_value(),
        base_url=settings.resend_api_base_url,
        timeout_seconds=settings.email_request_timeout_seconds,
    )


async def close_email_runtime() -> None:
    global _resend_client
    client = _resend_client
    _resend_client = None
    if client is not None:
        await client.aclose()


def get_resend_client() -> ResendClient:
    if _resend_client is None:
        raise RuntimeError("The Resend HTTP client is not initialized.")
    return _resend_client


def email_runtime_ready(settings: Settings) -> bool:
    return settings.email_delivery_mode == "log" or _resend_client is not None
