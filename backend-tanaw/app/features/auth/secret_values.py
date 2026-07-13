import base64
import hashlib
import hmac

from app.core.config import get_settings


def derive_account_activation_token(token_id: str) -> str:
    digest = _derive_digest("account-activation-value", token_id)
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def derive_password_reset_code(challenge_id: str) -> str:
    digest = _derive_digest("password-reset-code-value", challenge_id)
    value = int.from_bytes(digest[:8], "big") % 1_000_000
    return f"{value:06d}"


def derive_account_email_change_token(request_id: str) -> str:
    digest = _derive_digest("account-email-change-value", request_id)
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def hash_account_email_change_token(raw_token: str) -> str:
    settings = get_settings()
    return hmac.new(
        settings.email_secret_key_value.encode(),
        f"account-email-change:{raw_token}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _derive_digest(purpose: str, source_id: str) -> bytes:
    settings = get_settings()
    return hmac.new(
        settings.email_secret_key_value.encode(),
        f"{purpose}:{source_id}".encode(),
        hashlib.sha256,
    ).digest()
