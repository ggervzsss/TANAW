from app.core.config import Settings
from app.features.mail.client import BrevoClient

_brevo_client: BrevoClient | None = None


class EmailRuntimeError(RuntimeError):
    """Raised only when outbound email runtime configuration is unavailable."""


async def initialize_email_runtime(settings: Settings) -> None:
    global _brevo_client
    await close_email_runtime()
    if settings.email_delivery_mode != "brevo":
        return
    if settings.brevo_api_key is None:
        return
    _brevo_client = BrevoClient(
        settings.brevo_api_key.get_secret_value(),
        base_url=settings.brevo_api_base_url,
        timeout_seconds=settings.email_request_timeout_seconds,
    )


async def close_email_runtime() -> None:
    global _brevo_client
    client = _brevo_client
    _brevo_client = None
    if client is not None:
        await client.aclose()


def get_brevo_client() -> BrevoClient:
    if _brevo_client is None:
        raise EmailRuntimeError("The Brevo HTTP client is not initialized.")
    return _brevo_client


def email_runtime_ready(settings: Settings) -> bool:
    return settings.email_delivery_mode == "log" or _brevo_client is not None
