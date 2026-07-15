"""Typed access to the bounded runtime settings singleton."""

from collections.abc import Mapping
from typing import cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.features.accounts.models import SystemSetting

SYSTEM_SETTINGS_ID = "default"
SYSTEM_SETTING_KEYS = frozenset(
    {
        "security.loginAttemptLimit",
        "security.loginLockMinutes",
        "logs.retentionDays",
        "notifications.cameraSessionErrorAlerts",
        "notifications.gatewayServiceErrorAlerts",
        "notifications.syncDelayAlerts",
        "notifications.failedLoginLockoutAlerts",
    }
)
DEFAULT_SYSTEM_SETTINGS: dict[str, str | bool | int] = {
    "security.loginAttemptLimit": 3,
    "security.loginLockMinutes": 5,
    "logs.retentionDays": 180,
    "notifications.cameraSessionErrorAlerts": True,
    "notifications.gatewayServiceErrorAlerts": True,
    "notifications.syncDelayAlerts": True,
    "notifications.failedLoginLockoutAlerts": True,
}


async def get_system_settings(db: AsyncSession) -> SystemSetting | None:
    return cast(
        SystemSetting | None,
        await db.scalar(select(SystemSetting).where(SystemSetting.id == SYSTEM_SETTINGS_ID)),
    )


def system_settings_values(record: SystemSetting | None) -> dict[str, str | bool | int]:
    if record is None:
        return DEFAULT_SYSTEM_SETTINGS.copy()
    return {
        "security.loginAttemptLimit": record.login_attempt_limit,
        "security.loginLockMinutes": record.login_lock_minutes,
        "logs.retentionDays": record.log_retention_days,
        "notifications.cameraSessionErrorAlerts": record.camera_session_error_alerts,
        "notifications.gatewayServiceErrorAlerts": record.gateway_service_error_alerts,
        "notifications.syncDelayAlerts": record.sync_delay_alerts,
        "notifications.failedLoginLockoutAlerts": record.failed_login_lockout_alerts,
    }


def apply_system_settings(record: SystemSetting, values: Mapping[str, str | bool | int]) -> None:
    """Apply a complete API-validated settings document to typed columns."""

    record.login_attempt_limit = int(values["security.loginAttemptLimit"])
    record.login_lock_minutes = int(values["security.loginLockMinutes"])
    record.log_retention_days = int(values["logs.retentionDays"])
    record.camera_session_error_alerts = bool(values["notifications.cameraSessionErrorAlerts"])
    record.gateway_service_error_alerts = bool(values["notifications.gatewayServiceErrorAlerts"])
    record.sync_delay_alerts = bool(values["notifications.syncDelayAlerts"])
    record.failed_login_lockout_alerts = bool(values["notifications.failedLoginLockoutAlerts"])
