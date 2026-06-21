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
    access_token_expire_minutes: int = 60 * 8
    default_it_username: str = "default@email.tanaw"
    default_it_password: str = "default"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"
    geocoder_provider: str = "nominatim"
    geocoder_api_key: str | None = None
    geocoder_base_url: str | None = None
    geocoder_user_agent: str = "TANAW/1.0 local-development"
    render_external_url: str | None = Field(default=None, validation_alias="RENDER_EXTERNAL_URL")
    support_email: str | None = None
    support_phone: str | None = None
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
