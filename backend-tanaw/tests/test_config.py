import pytest

from app.core.config import Settings

PRODUCTION_FRONTEND_URL = "https://tanaw-sanpedro.vercel.app"
PRODUCTION_JWT_SECRET = "production-jwt-secret-with-at-least-32-characters"


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
    settings = Settings(
        environment="production",
        cors_origins="*",
        frontend_public_url=PRODUCTION_FRONTEND_URL,
        jwt_secret_key=PRODUCTION_JWT_SECRET,
    )

    with pytest.raises(ValueError, match="Wildcard CORS origins"):
        _ = settings.cors_origin_list


def test_local_cors_origins_are_rejected_in_production() -> None:
    settings = Settings(
        environment="production",
        frontend_public_url=PRODUCTION_FRONTEND_URL,
        jwt_secret_key=PRODUCTION_JWT_SECRET,
    )

    with pytest.raises(ValueError, match="Local or private CORS origins"):
        _ = settings.cors_origin_list


def test_private_ip_cors_origins_are_rejected_in_production() -> None:
    settings = Settings(
        environment="production",
        cors_origins="http://192.168.1.50:5173",
        frontend_public_url=PRODUCTION_FRONTEND_URL,
        jwt_secret_key=PRODUCTION_JWT_SECRET,
    )

    with pytest.raises(ValueError, match="Local or private CORS origins"):
        _ = settings.cors_origin_list


def test_production_frontend_origin_is_allowed_in_production() -> None:
    settings = Settings(
        environment="production",
        cors_origins="https://tanaw-sanpedro.vercel.app",
        frontend_public_url=PRODUCTION_FRONTEND_URL,
        jwt_secret_key=PRODUCTION_JWT_SECRET,
    )

    assert settings.cors_origin_list == ["https://tanaw-sanpedro.vercel.app"]


def test_local_frontend_public_url_is_rejected_in_production() -> None:
    with pytest.raises(ValueError, match="public HTTPS URL"):
        Settings(
            environment="production",
            cors_origins=PRODUCTION_FRONTEND_URL,
            jwt_secret_key=PRODUCTION_JWT_SECRET,
        )


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
        Settings(
            environment="production",
            cors_origins=PRODUCTION_FRONTEND_URL,
            frontend_public_url=PRODUCTION_FRONTEND_URL,
            jwt_secret_key=jwt_secret,
        )


def test_production_rejects_development_seed_accounts() -> None:
    with pytest.raises(ValueError, match="Development seed accounts"):
        Settings(
            environment="production",
            cors_origins=PRODUCTION_FRONTEND_URL,
            frontend_public_url=PRODUCTION_FRONTEND_URL,
            jwt_secret_key=PRODUCTION_JWT_SECRET,
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
        Settings(
            environment="production",
            cors_origins=PRODUCTION_FRONTEND_URL,
            frontend_public_url=PRODUCTION_FRONTEND_URL,
            jwt_secret_key=PRODUCTION_JWT_SECRET,
            bootstrap_it_username=username,
            bootstrap_it_password=password,
        )


def test_production_allows_bootstrap_credentials_to_be_removed_after_initialization() -> None:
    settings = Settings(
        environment="production",
        cors_origins=PRODUCTION_FRONTEND_URL,
        frontend_public_url=PRODUCTION_FRONTEND_URL,
        jwt_secret_key=PRODUCTION_JWT_SECRET,
    )

    assert settings.bootstrap_it_username is None
    assert settings.bootstrap_it_password is None


def test_development_seed_accounts_require_complete_credentials() -> None:
    with pytest.raises(ValueError, match=r"All DEVELOPMENT_\*"):
        Settings(seed_development_accounts=True)


def test_legacy_startup_environment_names_remain_supported(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DEFAULT_IT_USERNAME", "legacy-bootstrap@tanaw.local")
    monkeypatch.setenv("DEFAULT_IT_PASSWORD", "legacy-bootstrap-password")
    monkeypatch.setenv("TEMPORARY_ADMIN_USERNAME", "legacy-admin@tanaw.local")
    monkeypatch.setenv("TEMPORARY_ADMIN_PASSWORD", "legacy-admin-password")
    monkeypatch.setenv("TEMPORARY_STAFF_USERNAME", "legacy-staff@tanaw.local")
    monkeypatch.setenv("TEMPORARY_STAFF_PASSWORD", "legacy-staff-password")
    monkeypatch.setenv("TEMPORARY_IT_USERNAME", "legacy-it@tanaw.local")
    monkeypatch.setenv("TEMPORARY_IT_PASSWORD", "legacy-it-password")
    monkeypatch.setenv("TANAW_SEED_DEVELOPMENT_ACCOUNTS", "true")

    settings = Settings()

    assert settings.bootstrap_it_username == "legacy-bootstrap@tanaw.local"
    assert settings.development_admin_username == "legacy-admin@tanaw.local"
    assert settings.development_staff_username == "legacy-staff@tanaw.local"
    assert settings.development_it_username == "legacy-it@tanaw.local"
