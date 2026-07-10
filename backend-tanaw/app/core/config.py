from functools import lru_cache
from ipaddress import ip_address
from urllib.parse import urlsplit

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LOCAL_OR_PRIVATE_HOSTNAMES = {"localhost", "127.0.0.1", "0.0.0.0", "::1"}


class Settings(BaseSettings):
    app_name: str = "TANAW API"
    environment: str = Field(
        default="development", validation_alias=AliasChoices("TANAW_ENV", "ENVIRONMENT", "APP_ENV")
    )
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/tanaw_local"
    jwt_secret_key: str = "change-this-local-development-secret"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 30
    default_it_username: str = "default@email.com"
    default_it_password: str = "default"
    temporary_admin_username: str = "admin@email.com"
    temporary_admin_password: str = "admin123"
    temporary_staff_username: str = "staff@email.com"
    temporary_staff_password: str = "staffstaff"
    temporary_it_username: str = "it@email.com"
    temporary_it_password: str = "it123456"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"
    geocoder_provider: str = "nominatim"
    geocoder_api_key: str | None = None
    geocoder_base_url: str | None = None
    geocoder_user_agent: str = "TANAW/1.0 local-development"
    render_external_url: str | None = Field(default=None, validation_alias="RENDER_EXTERNAL_URL")
    email_delivery_mode: str = "log"
    resend_api_key: str | None = None
    resend_api_base_url: str = "https://api.resend.com"
    email_from_name: str = "TANAW"
    email_from_address: str = "onboarding@resend.dev"
    email_test_recipient: str | None = None
    email_request_timeout_seconds: float = 10.0
    allow_mock_data: bool = Field(
        default=False, validation_alias=AliasChoices("TANAW_ALLOW_MOCK_DATA", "ALLOW_MOCK_DATA")
    )

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
        "email_test_recipient",
        mode="before",
    )
    @classmethod
    def normalize_optional_email_setting(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        normalized = value.strip()
        return normalized or None

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
