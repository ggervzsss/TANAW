from dataclasses import dataclass
from typing import Protocol

from app.features.accounts.models import AccountRole

BOOTSTRAP_IT_DISPLAY_NAME = "Default IT Personnel"
DEVELOPMENT_ADMIN_DISPLAY_NAME = "LGU Admin"
DEVELOPMENT_STAFF_DISPLAY_NAME = "LGU Staff"
DEVELOPMENT_IT_DISPLAY_NAME = "IT Personnel"


class StartupAccountSettings(Protocol):
    bootstrap_it_username: str | None
    bootstrap_it_password: str | None
    seed_development_accounts: bool
    development_admin_username: str | None
    development_admin_password: str | None
    development_staff_username: str | None
    development_staff_password: str | None
    development_it_username: str | None
    development_it_password: str | None


@dataclass(frozen=True)
class StartupAccountSpec:
    username_setting: str
    role: AccountRole
    email: str
    password: str
    display_name: str
    title: str
    first_name: str
    last_name: str


def get_bootstrap_account_spec(
    settings: StartupAccountSettings,
) -> StartupAccountSpec | None:
    if settings.bootstrap_it_username is None or settings.bootstrap_it_password is None:
        return None
    return StartupAccountSpec(
        username_setting="BOOTSTRAP_IT_USERNAME",
        role=AccountRole.IT,
        email=settings.bootstrap_it_username.strip().lower(),
        password=settings.bootstrap_it_password,
        display_name=BOOTSTRAP_IT_DISPLAY_NAME,
        title="IT Personnel",
        first_name="Default",
        last_name="IT Personnel",
    )


def get_development_account_specs(
    settings: StartupAccountSettings,
) -> tuple[StartupAccountSpec, ...]:
    if not settings.seed_development_accounts:
        return ()

    values = (
        settings.development_admin_username,
        settings.development_admin_password,
        settings.development_staff_username,
        settings.development_staff_password,
        settings.development_it_username,
        settings.development_it_password,
    )
    if any(value is None for value in values):
        raise ValueError(
            "Development account credentials are incomplete. Check the DEVELOPMENT_* settings."
        )

    assert settings.development_admin_username is not None
    assert settings.development_admin_password is not None
    assert settings.development_staff_username is not None
    assert settings.development_staff_password is not None
    assert settings.development_it_username is not None
    assert settings.development_it_password is not None
    return (
        StartupAccountSpec(
            username_setting="DEVELOPMENT_ADMIN_USERNAME",
            role=AccountRole.ADMIN,
            email=settings.development_admin_username.strip().lower(),
            password=settings.development_admin_password,
            display_name=DEVELOPMENT_ADMIN_DISPLAY_NAME,
            title="Admin",
            first_name="LGU",
            last_name="Admin",
        ),
        StartupAccountSpec(
            username_setting="DEVELOPMENT_STAFF_USERNAME",
            role=AccountRole.STAFF,
            email=settings.development_staff_username.strip().lower(),
            password=settings.development_staff_password,
            display_name=DEVELOPMENT_STAFF_DISPLAY_NAME,
            title="LGU Staff",
            first_name="LGU",
            last_name="Staff",
        ),
        StartupAccountSpec(
            username_setting="DEVELOPMENT_IT_USERNAME",
            role=AccountRole.IT,
            email=settings.development_it_username.strip().lower(),
            password=settings.development_it_password,
            display_name=DEVELOPMENT_IT_DISPLAY_NAME,
            title="IT Personnel",
            first_name="IT",
            last_name="Personnel",
        ),
    )


def get_startup_account_specs(
    settings: StartupAccountSettings,
) -> tuple[StartupAccountSpec, ...]:
    bootstrap = get_bootstrap_account_spec(settings)
    return ((bootstrap,) if bootstrap is not None else ()) + get_development_account_specs(settings)
