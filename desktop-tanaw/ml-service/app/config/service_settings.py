import os
from dataclasses import dataclass
from ipaddress import ip_address

MIN_REMOTE_ACCESS_TOKEN_LENGTH = 32


@dataclass(frozen=True, slots=True)
class ServiceSettings:
    access_token: str = ""
    bind_host: str = "127.0.0.1"
    allowed_origins: tuple[str, ...] = (
        "file://",
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "null",
    )

    def __post_init__(self) -> None:
        if not self.bind_host or self.bind_host != self.bind_host.strip():
            raise ValueError(
                "TANAW_ML_SERVICE_HOST must be a non-empty host without surrounding whitespace."
            )
        if is_loopback_bind_host(self.bind_host):
            return
        if not is_valid_remote_access_token(self.access_token):
            raise ValueError(
                "TANAW_ML_SERVICE_TOKEN must contain at least "
                f"{MIN_REMOTE_ACCESS_TOKEN_LENGTH} non-whitespace characters when "
                "TANAW_ML_SERVICE_HOST is not loopback."
            )

    @classmethod
    def from_environment(cls) -> "ServiceSettings":
        return cls(
            access_token=os.environ.get("TANAW_ML_SERVICE_TOKEN", ""),
            bind_host=os.environ.get("TANAW_ML_SERVICE_HOST", "127.0.0.1"),
        )


def is_loopback_bind_host(host: str) -> bool:
    if host.lower() == "localhost":
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


def is_valid_remote_access_token(token: str) -> bool:
    return len(token) >= MIN_REMOTE_ACCESS_TOKEN_LENGTH and not any(
        character.isspace() for character in token
    )
