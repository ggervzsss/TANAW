from app.features.auth.system_settings import merge_system_settings_values


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
