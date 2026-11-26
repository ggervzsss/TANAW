import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from app.features.accounts.models import Account, AccountRole, AccountStatus, SystemConfiguration
from app.features.activity_logs.service import ALLOWED_LOG_RETENTION_DAYS
from app.features.auth import settings_router
from app.features.auth.schemas import SystemSettingsPayload
from app.features.auth.service import ALLOWED_LOGIN_ATTEMPT_LIMITS, ALLOWED_LOGIN_LOCK_MINUTES
from app.features.auth.system_settings import (
    SYSTEM_SETTING_RULES,
    SystemSettingValue,
    changed_system_settings,
    describe_system_settings_change,
    merge_system_settings_values,
    system_settings_patch_errors,
)
from app.features.monitoring.alerts import ALLOWED_CAMERA_WAIT_MINUTES


def test_system_settings_patch_preserves_unrelated_values() -> None:
    current: dict[str, str | bool | int] = {
        "security.loginAttemptLimit": 5,
        "display.timeFormat": "12-hour",
        "notifications.cameraSessionErrorAlerts": True,
    }

    updated = merge_system_settings_values(
        current, {"notifications.cameraSessionErrorAlerts": False}
    )

    assert updated == {
        "security.loginAttemptLimit": 5,
        "display.timeFormat": "12-hour",
        "notifications.cameraSessionErrorAlerts": False,
    }
    assert current["notifications.cameraSessionErrorAlerts"] is True


def test_every_allowed_setting_value_is_accepted() -> None:
    patch: dict[str, SystemSettingValue] = {
        "security.loginAttemptLimit": 10,
        "security.loginLockMinutes": 60,
        "logs.retentionDays": 365,
        "display.timeFormat": "24-hour",
        "display.dateFormat": "yyyy-MM-dd",
        "monitoring.cameraWaitMinutes": 5,
    }

    assert system_settings_patch_errors(patch) == []
    for date_format in ("MMM d, yyyy", "d MMM yyyy", "MM/dd/yyyy", "yyyy-MM-dd"):
        assert system_settings_patch_errors({"display.dateFormat": date_format}) == []


@pytest.mark.parametrize(
    "patch",
    (
        {"notifications.cameraSessionErrorAlerts": True},
        {"security.loginAttemptLimit": 4},
        {"security.loginAttemptLimit": "5"},
        {"security.loginAttemptLimit": True},
        {"logs.retentionDays": 30},
        {"display.timeFormat": "military"},
        {"display.dateFormat": "dd.MM.yyyy"},
        {"monitoring.cameraWaitMinutes": 1},
    ),
)
def test_unknown_keys_and_values_are_rejected(patch: dict[str, SystemSettingValue]) -> None:
    assert len(system_settings_patch_errors(patch)) == 1


def test_setting_rules_match_the_values_each_feature_accepts() -> None:
    def allowed(key: str) -> set[str | int]:
        return set(SYSTEM_SETTING_RULES[key].allowed_values)

    assert allowed("security.loginAttemptLimit") == set(ALLOWED_LOGIN_ATTEMPT_LIMITS)
    assert allowed("security.loginLockMinutes") == set(ALLOWED_LOGIN_LOCK_MINUTES)
    assert allowed("logs.retentionDays") == set(ALLOWED_LOG_RETENTION_DAYS)
    assert allowed("monitoring.cameraWaitMinutes") == set(ALLOWED_CAMERA_WAIT_MINUTES)


def test_activity_summary_names_only_the_settings_that_changed() -> None:
    current: dict[str, SystemSettingValue] = {
        "display.timeFormat": "12-hour",
        "logs.retentionDays": 180,
    }
    patch: dict[str, SystemSettingValue] = {
        "display.timeFormat": "24-hour",
        "logs.retentionDays": 180,
        "display.dateFormat": "d MMM yyyy",
    }

    changes = changed_system_settings(current, patch)

    assert [change.key for change in changes] == ["display.timeFormat", "display.dateFormat"]
    assert changes[1].previous is None
    assert (
        describe_system_settings_change("Jose Reyes", changes)
        == "Jose Reyes changed Time format and Date format."
    )
    assert describe_system_settings_change("Jose Reyes", []) == (
        "Jose Reyes saved system settings without changing them."
    )


def _it_account() -> Account:
    return Account(
        id="it-1",
        email="it@example.com",
        password_hash="hash",
        role=AccountRole.IT,
        display_name="Jose Reyes",
        title="IT Personnel",
        status=AccountStatus.ACTIVE,
    )


@pytest.mark.asyncio
async def test_saving_an_unknown_setting_is_rejected_before_anything_is_stored() -> None:
    db = MagicMock()
    db.scalar = AsyncMock()

    with pytest.raises(HTTPException) as raised:
        await settings_router.update_system_settings(
            SystemSettingsPayload(values={"display.dateFormat": "dd.MM.yyyy"}),
            _it_account(),
            db,
        )

    assert raised.value.status_code == 422
    db.scalar.assert_not_awaited()


@pytest.mark.asyncio
async def test_saving_settings_logs_the_changed_keys(monkeypatch: pytest.MonkeyPatch) -> None:
    record = SystemConfiguration(
        id="default", values_json=json.dumps({"display.timeFormat": "12-hour"})
    )
    db = MagicMock()
    db.scalar = AsyncMock(return_value=record)
    db.flush = AsyncMock()
    db.refresh = AsyncMock()
    record_log = AsyncMock()
    monkeypatch.setattr(settings_router, "record_auth_log", record_log)

    response = await settings_router.update_system_settings(
        SystemSettingsPayload(values={"display.timeFormat": "24-hour"}),
        _it_account(),
        db,
    )

    assert response.values == {"display.timeFormat": "24-hour"}
    log_kwargs = record_log.await_args.kwargs  # type: ignore[union-attr]
    assert log_kwargs["summary"] == "Jose Reyes changed Time format."
    assert log_kwargs["metadata"] == {"changedKeys": "display.timeFormat"}
    assert log_kwargs["it_detail"] == "display.timeFormat: 12-hour → 24-hour"
