from dataclasses import dataclass
from typing import Protocol

from app.features.accounts.models import AccountRole

DEFAULT_IT_DISPLAY_NAME = "Default IT Personnel"
TEMPORARY_ADMIN_DISPLAY_NAME = "LGU Admin"
TEMPORARY_STAFF_DISPLAY_NAME = "LGU Staff"
TEMPORARY_IT_DISPLAY_NAME = "IT Personnel"


class StartupAccountSettings(Protocol):
    default_it_username: str
    default_it_password: str
    temporary_admin_username: str
    temporary_admin_password: str
    temporary_staff_username: str
    temporary_staff_password: str
    temporary_it_username: str
    temporary_it_password: str


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


def get_startup_account_specs(
    settings: StartupAccountSettings,
) -> tuple[StartupAccountSpec, ...]:
    return (
        StartupAccountSpec(
            username_setting="DEFAULT_IT_USERNAME",
            role=AccountRole.IT,
            email=settings.default_it_username.strip().lower(),
            password=settings.default_it_password,
            display_name=DEFAULT_IT_DISPLAY_NAME,
            title="IT Personnel",
            first_name="Default",
            last_name="IT Personnel",
        ),
        StartupAccountSpec(
            username_setting="TEMPORARY_ADMIN_USERNAME",
            role=AccountRole.ADMIN,
            email=settings.temporary_admin_username.strip().lower(),
            password=settings.temporary_admin_password,
            display_name=TEMPORARY_ADMIN_DISPLAY_NAME,
            title="Admin",
            first_name="LGU",
            last_name="Admin",
        ),
        StartupAccountSpec(
            username_setting="TEMPORARY_STAFF_USERNAME",
            role=AccountRole.STAFF,
            email=settings.temporary_staff_username.strip().lower(),
            password=settings.temporary_staff_password,
            display_name=TEMPORARY_STAFF_DISPLAY_NAME,
            title="LGU Staff",
            first_name="LGU",
            last_name="Staff",
        ),
        StartupAccountSpec(
            username_setting="TEMPORARY_IT_USERNAME",
            role=AccountRole.IT,
            email=settings.temporary_it_username.strip().lower(),
            password=settings.temporary_it_password,
            display_name=TEMPORARY_IT_DISPLAY_NAME,
            title="IT Personnel",
            first_name="IT",
            last_name="Personnel",
        ),
    )
