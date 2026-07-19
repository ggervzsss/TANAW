import hmac
from functools import lru_cache
from ipaddress import ip_address
from typing import Self
from urllib.parse import urlsplit

from pydantic import EmailStr, Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LOCAL_OR_PRIVATE_HOSTNAMES = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}
DEVELOPMENT_JWT_SECRET = "change-this-local-development-secret"
PLACEHOLDER_BOOTSTRAP_EMAILS = {"default@email.com", "bootstrap@example.com"}
PLACEHOLDER_BOOTSTRAP_PASSWORDS = {"default", "change-me", "password"}


class Settings(BaseSettings):
    app_name: str = "TANAW API"
    environment: str = Field(default="development", validation_alias="TANAW_ENV")
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/TanawDB"
    jwt_secret_key: str = DEVELOPMENT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 30
    session_cookie_expire_minutes: int = Field(default=60 * 8, ge=60, le=60 * 24 * 30)
    bootstrap_it_username: str | None = Field(
        default=None,
        validation_alias="BOOTSTRAP_IT_USERNAME",
    )
    bootstrap_it_password: str | None = Field(
        default=None,
        validation_alias="BOOTSTRAP_IT_PASSWORD",
    )
    seed_development_accounts: bool = Field(
        default=False,
        validation_alias="TANAW_SEED_DEVELOPMENT_ACCOUNTS",
    )
    development_admin_username: str | None = Field(
        default=None,
        validation_alias="DEVELOPMENT_ADMIN_USERNAME",
    )
    development_admin_password: str | None = Field(
        default=None,
        validation_alias="DEVELOPMENT_ADMIN_PASSWORD",
    )
    development_staff_username: str | None = Field(
        default=None,
        validation_alias="DEVELOPMENT_STAFF_USERNAME",
    )
    development_staff_password: str | None = Field(
        default=None,
        validation_alias="DEVELOPMENT_STAFF_PASSWORD",
    )
    development_it_username: str | None = Field(
        default=None,
        validation_alias="DEVELOPMENT_IT_USERNAME",
    )
    development_it_password: str | None = Field(
        default=None,
        validation_alias="DEVELOPMENT_IT_PASSWORD",
    )
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"
    render_external_url: str | None = Field(default=None, validation_alias="RENDER_EXTERNAL_URL")
    email_delivery_mode: str = "log"
    resend_api_key: SecretStr | None = None
    resend_api_base_url: str = "https://api.resend.com"
    email_from_name: str = "TANAW"
    email_from_address: EmailStr = "onboarding@resend.dev"
    email_test_recipient: EmailStr | None = None
    email_request_timeout_seconds: float = Field(default=10.0, ge=0.5, le=60.0)
    email_secret_derivation_key: SecretStr | None = None
    email_outbox_poll_interval_seconds: float = Field(default=1.0, ge=0.1, le=10.0)
    email_outbox_lease_seconds: int = Field(default=120, ge=30, le=600)
    email_outbox_batch_size: int = Field(default=5, ge=1, le=25)
    email_outbox_max_attempts: int = Field(default=5, ge=1, le=10)
    password_reset_rate_window_seconds: int = Field(default=900, ge=60, le=3600)
    password_reset_per_ip_limit: int = Field(default=10, ge=1, le=100)
    password_reset_per_identifier_limit: int = Field(default=5, ge=1, le=50)
    password_reset_global_limit: int = Field(default=200, ge=10, le=10_000)
    password_reset_resend_cooldown_seconds: int = Field(default=60, ge=30, le=300)
    password_reset_response_floor_seconds: float = Field(default=0.25, ge=0.0, le=2.0)
    frontend_public_url: str = "http://localhost:5173"
    account_activation_ttl_hours: int = Field(default=24, ge=1, le=168)
    account_email_change_ttl_hours: int = Field(default=24, ge=1, le=168)
    retention_cleanup_interval_seconds: int = Field(default=3600, ge=60, le=86_400)
    retention_cleanup_batch_size: int = Field(default=500, ge=10, le=5000)
    activation_token_retention_days: int = Field(default=30, ge=1, le=3650)
    password_reset_retention_days: int = Field(default=30, ge=1, le=3650)
    password_reset_rate_bucket_retention_days: int = Field(default=2, ge=1, le=90)
    account_email_change_retention_days: int = Field(default=180, ge=30, le=3650)
    development_delivery_retention_days: int = Field(default=7, ge=1, le=90)
    email_outbox_retention_days: int = Field(default=180, ge=30, le=3650)
    failed_email_outbox_retention_days: int = Field(default=365, ge=30, le=3650)
    allow_mock_data: bool = Field(default=False, validation_alias="TANAW_ALLOW_MOCK_DATA")

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", populate_by_name=True
    )

    @field_validator("database_url", mode="before")
    @classmethod
    def normalize_database_url(cls, value: object) -> object:
        if not isinstance(value, str):
            return value

        if value.startswith("postgres://"):
            value = f"postgresql://{value.removeprefix('postgres://')}"

        if value.startswith("postgresql://"):
            return value.replace("postgresql://", "postgresql+asyncpg://", 1)

        return value

    @field_validator("email_delivery_mode")
    @classmethod
    def validate_email_delivery_mode(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"log", "resend"}:
            raise ValueError("EMAIL_DELIVERY_MODE must be either 'log' or 'resend'.")
        return normalized

    @field_validator(
        "resend_api_key",
        "email_secret_derivation_key",
        "email_test_recipient",
        "bootstrap_it_username",
        "bootstrap_it_password",
        "development_admin_username",
        "development_admin_password",
        "development_staff_username",
        "development_staff_password",
        "development_it_username",
        "development_it_password",
        mode="before",
    )
    @classmethod
    def normalize_optional_email_setting(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = value.strip()
        return normalized or None

    @field_validator("frontend_public_url")
    @classmethod
    def normalize_frontend_public_url(cls, value: str) -> str:
        normalized = value.strip().rstrip("/")
        parsed = urlsplit(normalized)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("FRONTEND_PUBLIC_URL must be an absolute HTTP(S) URL.")
        return normalized

    @field_validator("resend_api_base_url")
    @classmethod
    def normalize_resend_api_base_url(cls, value: str) -> str:
        normalized = value.strip().rstrip("/")
        parsed = urlsplit(normalized)
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.netloc
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("RESEND_API_BASE_URL must be an absolute HTTP(S) URL.")
        return normalized

    @field_validator("email_from_name")
    @classmethod
    def normalize_email_from_name(cls, value: str) -> str:
        normalized = " ".join(value.strip().split())
        if not normalized or len(normalized) > 80:
            raise ValueError("EMAIL_FROM_NAME must contain between 1 and 80 characters.")
        return normalized

    @model_validator(mode="after")
    def validate_environment_safety(self) -> Self:
        self._validate_development_account_configuration()
        if self.is_production and (
            urlsplit(self.frontend_public_url).scheme != "https"
            or is_local_or_private_origin(self.frontend_public_url)
        ):
            raise ValueError("FRONTEND_PUBLIC_URL must use a public HTTPS URL in production.")
        if self.is_production:
            self._validate_production_credentials()
            self._validate_production_email()
        return self

    def _validate_development_account_configuration(self) -> None:
        values = (
            self.development_admin_username,
            self.development_admin_password,
            self.development_staff_username,
            self.development_staff_password,
            self.development_it_username,
            self.development_it_password,
        )
        if self.seed_development_accounts and any(value is None for value in values):
            raise ValueError(
                "All DEVELOPMENT_* account credentials are required when "
                "TANAW_SEED_DEVELOPMENT_ACCOUNTS=true."
            )

    def _validate_production_credentials(self) -> None:
        normalized_jwt_secret = self.jwt_secret_key.strip().lower()
        if (
            self.jwt_secret_key == DEVELOPMENT_JWT_SECRET
            or len(self.jwt_secret_key) < 32
            or normalized_jwt_secret.startswith(("change-this", "replace-this", "replace_with"))
            or "<" in self.jwt_secret_key
            or ">" in self.jwt_secret_key
        ):
            raise ValueError(
                "JWT_SECRET_KEY must be a unique secret of at least 32 characters in production."
            )
        if self.seed_development_accounts:
            raise ValueError("Development seed accounts are not allowed in production.")

        bootstrap_values = (self.bootstrap_it_username, self.bootstrap_it_password)
        if any(value is not None for value in bootstrap_values) and any(
            value is None for value in bootstrap_values
        ):
            raise ValueError(
                "BOOTSTRAP_IT_USERNAME and BOOTSTRAP_IT_PASSWORD must be configured together."
            )
        if self.bootstrap_it_username is not None and (
            self.bootstrap_it_username.lower() in PLACEHOLDER_BOOTSTRAP_EMAILS
            or self.bootstrap_it_username.lower().endswith("@example.com")
        ):
            raise ValueError("BOOTSTRAP_IT_USERNAME must not use a placeholder email.")
        if self.bootstrap_it_password is not None and (
            self.bootstrap_it_password.lower() in PLACEHOLDER_BOOTSTRAP_PASSWORDS
            or len(self.bootstrap_it_password) < 12
        ):
            raise ValueError(
                "BOOTSTRAP_IT_PASSWORD must be a unique password of at least 12 characters."
            )

    def _validate_production_email(self) -> None:
        if self.email_delivery_mode != "resend":
            raise ValueError("EMAIL_DELIVERY_MODE must be 'resend' in production.")
        if self.resend_api_key is None:
            raise ValueError("RESEND_API_KEY is required in production.")
        if self.email_secret_derivation_key is None:
            raise ValueError("EMAIL_SECRET_DERIVATION_KEY is required in production.")

        derivation_key = self.email_secret_derivation_key.get_secret_value().strip()
        normalized_derivation_key = derivation_key.lower()
        if (
            len(derivation_key) < 32
            or normalized_derivation_key.startswith(("change-this", "replace-this", "replace_with"))
            or "<" in derivation_key
            or ">" in derivation_key
        ):
            raise ValueError(
                "EMAIL_SECRET_DERIVATION_KEY must be a unique secret of at least 32 characters."
            )
        if hmac.compare_digest(derivation_key, self.jwt_secret_key):
            raise ValueError("EMAIL_SECRET_DERIVATION_KEY must be different from JWT_SECRET_KEY.")

        api_key = self.resend_api_key.get_secret_value().strip()
        normalized_key = api_key.lower()
        if (
            not api_key.startswith("re_")
            or len(api_key) < 20
            or any(
                placeholder in normalized_key
                for placeholder in ("replace", "change", "example", "your_resend")
            )
            or "<" in api_key
            or ">" in api_key
        ):
            raise ValueError("RESEND_API_KEY must be a non-placeholder Resend sending key.")

        sender_domain = str(self.email_from_address).rsplit("@", 1)[1].lower()
        if sender_domain in {
            "resend.dev",
            "example.com",
            "example.net",
            "example.org",
        } or sender_domain.endswith((".example", ".example.com")):
            raise ValueError(
                "EMAIL_FROM_ADDRESS must use a verified custom sending domain in production."
            )
        if self.email_test_recipient is not None:
            raise ValueError(
                "EMAIL_TEST_RECIPIENT must be omitted in production after domain verification."
            )
        if self.resend_api_base_url != "https://api.resend.com":
            raise ValueError("RESEND_API_BASE_URL must be https://api.resend.com in production.")
        if self.password_reset_response_floor_seconds < 0.15:
            raise ValueError(
                "PASSWORD_RESET_RESPONSE_FLOOR_SECONDS must be at least 0.15 in production."
            )

    @property
    def cors_origin_list(self) -> list[str]:
        origins = [
            origin.strip().rstrip("/") for origin in self.cors_origins.split(",") if origin.strip()
        ]
        if self.is_production:
            if "*" in origins:
                raise ValueError("Wildcard CORS origins are not allowed in production.")
            if any(is_local_or_private_origin(origin) for origin in origins):
                raise ValueError("Local or private CORS origins are not allowed in production.")
        return origins

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() in {"prod", "production"} or bool(
            self.render_external_url
        )

    @property
    def email_secret_key_value(self) -> str:
        if self.email_secret_derivation_key is not None:
            return self.email_secret_derivation_key.get_secret_value()
        return self.jwt_secret_key


@lru_cache
def get_settings() -> Settings:
    return Settings()


def is_local_or_private_origin(origin: str) -> bool:
    hostname = urlsplit(origin).hostname
    if hostname is None:
        return False

    hostname = hostname.lower()
    if hostname in LOCAL_OR_PRIVATE_HOSTNAMES:
        return True

    try:
        address = ip_address(hostname)
    except ValueError:
        return False

    return address.is_loopback or address.is_private
