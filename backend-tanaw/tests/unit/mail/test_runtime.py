import pytest
from pydantic import SecretStr

from app.core.config import Settings
from app.features.mail.runtime import (
    close_email_runtime,
    email_runtime_ready,
    get_brevo_client,
    initialize_email_runtime,
)


@pytest.mark.asyncio
async def test_brevo_runtime_is_initialized_once_and_closed_explicitly() -> None:
    settings = Settings(
        email_delivery_mode="brevo",
        brevo_api_key=SecretStr("xkeysib-test_sending_key_123456789"),
    )

    await initialize_email_runtime(settings)
    try:
        first_client = get_brevo_client()
        second_client = get_brevo_client()
        assert first_client is second_client
        assert email_runtime_ready(settings) is True
    finally:
        await close_email_runtime()

    assert email_runtime_ready(settings) is False
    with pytest.raises(RuntimeError, match="not initialized"):
        get_brevo_client()
