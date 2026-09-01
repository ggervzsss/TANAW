from typing import Any

import pytest
from pydantic import SecretStr

from app.core.config import Settings

PRODUCTION_FRONTEND_URL = "https://tanaw-sanpedro.vercel.app"
PRODUCTION_JWT_SECRET = "production-jwt-secret-with-at-least-32-characters"
PRODUCTION_SETTINGS: dict[str, Any] = {
    "environment": "production",
    "cors_origins": PRODUCTION_FRONTEND_URL,
    "frontend_public_url": PRODUCTION_FRONTEND_URL,
    "jwt_secret_key": PRODUCTION_JWT_SECRET,
    "email_delivery_mode": "brevo",
    "brevo_api_key": "xkeysib-production_sending_key_123456789",
    "email_secret_derivation_key": "production-email-secret-different-from-jwt-2026",
    "email_from_address": "no-reply@mail.tanaw-sanpedro.ph",
}


def production_settings(**overrides: Any) -> Settings:
    return Settings(**(PRODUCTION_SETTINGS | overrides))


def test_database_url_uses_asyncpg_for_plain_postgresql_url() -> None:
    settings = Settings(database_url="postgresql://user:pass@example.com:5432/tanaw")

    assert settings.database_url == "postgresql+asyncpg://user:pass@example.com:5432/tanaw"


def test_database_url_uses_asyncpg_for_postgres_provider_url() -> None:
    settings = Settings(database_url="postgres://user:pass@example.com:5432/tanaw")

    assert settings.database_url == "postgresql+asyncpg://user:pass@example.com:5432/tanaw"


def test_database_url_preserves_explicit_driver() -> None:
    settings = Settings(database_url="postgresql+asyncpg://user:pass@example.com:5432/tanaw")

    assert settings.database_url == "postgresql+asyncpg://user:pass@example.com:5432/tanaw"


def test_default_access_token_lifetime_supports_continuous_operation() -> None:
    settings = Settings()

    assert settings.access_token_expire_minutes == 60 * 24 * 30


def test_email_delivery_defaults_to_safe_local_logging() -> None:
    settings = Settings()

    assert settings.email_delivery_mode == "log"
    assert settings.brevo_api_key is None


def test_blank_geoapify_key_disables_location_search() -> None:
    settings = Settings(geoapify_api_key=SecretStr("  "))

    assert settings.geoapify_api_key is None


def test_invalid_email_delivery_mode_is_rejected() -> None:
    with pytest.raises(ValueError, match="EMAIL_DELIVERY_MODE"):
        Settings(email_delivery_mode="smtp")


def test_cors_origins_are_trimmed_and_normalized() -> None:
    settings = Settings(cors_origins=" https://tanaw-sanpedro.vercel.app/, http://localhost:5173 ")

    assert settings.cors_origin_list == [
        "https://tanaw-sanpedro.vercel.app",
        "http://localhost:5173",
    ]


def test_wildcard_cors_origin_is_rejected_in_production() -> None:
    settings = production_settings(cors_origins="*")

    with pytest.raises(ValueError, match="Wildcard CORS origins"):
        _ = settings.cors_origin_list


def test_local_cors_origins_are_rejected_in_production() -> None:
    settings = production_settings(
        cors_origins="http://localhost:5173",
    )

    with pytest.raises(ValueError, match="Local or private CORS origins"):
        _ = settings.cors_origin_list


def test_private_ip_cors_origins_are_rejected_in_production() -> None:
    settings = production_settings(
        cors_origins="http://192.168.1.50:5173",
    )

    with pytest.raises(ValueError, match="Local or private CORS origins"):
        _ = settings.cors_origin_list


def test_production_frontend_origin_is_allowed_in_production() -> None:
    settings = production_settings()

    assert settings.cors_origin_list == ["https://tanaw-sanpedro.vercel.app"]


def test_local_frontend_public_url_is_rejected_in_production() -> None:
    with pytest.raises(ValueError, match="public HTTPS URL"):
        production_settings(frontend_public_url="http://localhost:5173")


@pytest.mark.parametrize(
    "jwt_secret",
    [
        "change-this-local-development-secret",
        "too-short",
        "replace_with_a_long_random_secret",
        "replace-this-with-a-long-random-secret",
        "<new-long-random-production-secret>",
    ],
)
def test_production_rejects_default_short_or_placeholder_jwt_secrets(
    jwt_secret: str,
) -> None:
    with pytest.raises(ValueError, match="JWT_SECRET_KEY"):
        production_settings(jwt_secret_key=jwt_secret)


def test_production_rejects_development_seed_accounts() -> None:
    with pytest.raises(ValueError, match="Development seed accounts"):
        production_settings(
            seed_development_accounts=True,
            development_admin_username="admin@tanaw.local",
            development_admin_password="AdminDevelopment2!",
            development_staff_username="staff@tanaw.local",
            development_staff_password="StaffDevelopment2!",
            development_it_username="it@tanaw.local",
            development_it_password="ItDevelopment2!",
        )


@pytest.mark.parametrize(
    ("username", "password", "message"),
    [
        ("default@email.com", "StrongBootstrap2!", "BOOTSTRAP_IT_USERNAME"),
        ("bootstrap@tanaw.gov.ph", "default", "BOOTSTRAP_IT_PASSWORD"),
        ("bootstrap@tanaw.gov.ph", "Short2!", "BOOTSTRAP_IT_PASSWORD"),
    ],
)
def test_production_rejects_placeholder_bootstrap_credentials(
    username: str, password: str, message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        production_settings(
            bootstrap_it_username=username,
            bootstrap_it_password=password,
        )


def test_production_allows_bootstrap_credentials_to_be_removed_after_initialization() -> None:
    settings = production_settings()

    assert settings.bootstrap_it_username is None
    assert settings.bootstrap_it_password is None


def test_production_accepts_complete_verified_domain_email_configuration() -> None:
    settings = production_settings()

    assert settings.email_delivery_mode == "brevo"
    assert settings.brevo_api_key is not None
    assert settings.brevo_api_key.get_secret_value().startswith("xkeysib-")
    assert str(settings.email_from_address) == "no-reply@mail.tanaw-sanpedro.ph"


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"email_delivery_mode": "log"}, "EMAIL_DELIVERY_MODE"),
        ({"brevo_api_key": None}, "BREVO_API_KEY"),
        ({"email_secret_derivation_key": None}, "EMAIL_SECRET_DERIVATION_KEY"),
        (
            {"email_secret_derivation_key": PRODUCTION_JWT_SECRET},
            "different from JWT_SECRET_KEY",
        ),
        ({"brevo_api_key": "replace_with_your_brevo_api_key"}, "BREVO_API_KEY"),
        ({"email_from_address": "no-reply@example.com"}, "verified Brevo sender"),
        ({"brevo_api_base_url": "https://api.example.com"}, "BREVO_API_BASE_URL"),
    ],
)
def test_production_rejects_incomplete_or_placeholder_email_configuration(
    overrides: dict[str, object], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        production_settings(**overrides)


@pytest.mark.parametrize("timeout", [0, -1, 61])
def test_email_provider_timeout_is_positive_and_bounded(timeout: float) -> None:
    with pytest.raises(ValueError, match="email_request_timeout_seconds"):
        Settings(email_request_timeout_seconds=timeout)


def test_password_recovery_abuse_controls_have_bounded_defaults() -> None:
    settings = Settings()

    assert settings.password_reset_rate_window_seconds == 900
    assert settings.password_reset_per_ip_limit == 10
    assert settings.password_reset_per_identifier_limit == 5
    assert settings.password_reset_global_limit == 200
    assert settings.password_reset_resend_cooldown_seconds == 60
    assert settings.password_reset_response_floor_seconds == 0.25


def test_retention_cleanup_has_bounded_documented_defaults() -> None:
    settings = Settings()

    assert settings.retention_cleanup_interval_seconds == 3600
    assert settings.retention_cleanup_batch_size == 500
    assert settings.telemetry_raw_retention_days == 45
    assert settings.telemetry_retention_batch_size == 10_000
    assert settings.activation_token_retention_days == 30
    assert settings.password_reset_retention_days == 30
    assert settings.password_reset_rate_bucket_retention_days == 2
    assert settings.account_email_change_retention_days == 180
    assert settings.email_outbox_retention_days == 180
    assert settings.failed_email_outbox_retention_days == 365


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("retention_cleanup_interval_seconds", 59),
        ("retention_cleanup_interval_seconds", 86_401),
        ("retention_cleanup_batch_size", 9),
        ("retention_cleanup_batch_size", 5001),
        ("telemetry_raw_retention_days", 34),
        ("telemetry_raw_retention_days", 366),
        ("telemetry_retention_batch_size", 99),
        ("telemetry_retention_batch_size", 50_001),
        ("activation_token_retention_days", 0),
        ("password_reset_retention_days", 0),
        ("password_reset_rate_bucket_retention_days", 0),
        ("account_email_change_retention_days", 29),
        ("email_outbox_retention_days", 29),
        ("failed_email_outbox_retention_days", 29),
    ],
)
def test_retention_cleanup_settings_reject_unsafe_bounds(name: str, value: int) -> None:
    with pytest.raises(ValueError, match=name):
        Settings.model_validate({name: value})


def test_production_requires_a_password_recovery_timing_floor() -> None:
    with pytest.raises(ValueError, match="PASSWORD_RESET_RESPONSE_FLOOR_SECONDS"):
        production_settings(password_reset_response_floor_seconds=0.1)


def test_sender_must_be_a_valid_email_address() -> None:
    with pytest.raises(ValueError):
        Settings(email_from_address="not-an-email")


def test_development_seed_accounts_require_complete_credentials() -> None:
    with pytest.raises(ValueError, match=r"All DEVELOPMENT_\*"):
        Settings(seed_development_accounts=True)
