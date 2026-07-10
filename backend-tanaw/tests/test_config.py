import pytest

from app.core.config import Settings


def test_database_url_uses_asyncpg_for_plain_postgresql_url() -> None:
    settings = Settings(database_url="postgresql://user:pass@example.com:5432/tanaw")

    assert settings.database_url == "postgresql+asyncpg://user:pass@example.com:5432/tanaw"


def test_database_url_uses_asyncpg_for_legacy_postgres_url() -> None:
    settings = Settings(database_url="postgres://user:pass@example.com:5432/tanaw")

    assert settings.database_url == "postgresql+asyncpg://user:pass@example.com:5432/tanaw"


def test_database_url_preserves_explicit_driver() -> None:
    settings = Settings(database_url="postgresql+asyncpg://user:pass@example.com:5432/tanaw")

    assert settings.database_url == "postgresql+asyncpg://user:pass@example.com:5432/tanaw"


def test_mock_data_flag_uses_tanaw_prefixed_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TANAW_ALLOW_MOCK_DATA", "true")

    settings = Settings()

    assert settings.allow_mock_data is True


def test_default_access_token_lifetime_supports_continuous_operation() -> None:
    settings = Settings()

    assert settings.access_token_expire_minutes == 60 * 24 * 30


def test_email_delivery_defaults_to_safe_local_logging() -> None:
    settings = Settings()

    assert settings.email_delivery_mode == "log"
    assert settings.resend_api_key is None


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
    settings = Settings(environment="production", cors_origins="*")

    with pytest.raises(ValueError, match="Wildcard CORS origins"):
        _ = settings.cors_origin_list


def test_local_cors_origins_are_rejected_in_production() -> None:
    settings = Settings(environment="production")

    with pytest.raises(ValueError, match="Local or private CORS origins"):
        _ = settings.cors_origin_list


def test_private_ip_cors_origins_are_rejected_in_production() -> None:
    settings = Settings(environment="production", cors_origins="http://192.168.1.50:5173")

    with pytest.raises(ValueError, match="Local or private CORS origins"):
        _ = settings.cors_origin_list


def test_production_frontend_origin_is_allowed_in_production() -> None:
    settings = Settings(environment="production", cors_origins="https://tanaw-sanpedro.vercel.app")

    assert settings.cors_origin_list == ["https://tanaw-sanpedro.vercel.app"]
