import os
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ServiceSettings:
    access_token: str = ""
    allowed_origins: tuple[str, ...] = (
        "file://",
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "null",
    )

    @classmethod
    def from_environment(cls) -> "ServiceSettings":
        return cls(access_token=os.environ.get("TANAW_ML_SERVICE_TOKEN", ""))
