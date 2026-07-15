from app.features.alerts.service import can_view_operational_event
from app.features.notifications.service import (
    NOTIFY_FAILED_LOGIN_LOCKOUT_KEY,
    resolve_system_setting_enabled,
)


def test_websocket_authorization_rejects_removed_event_contracts() -> None:
    for event_type in (
        "telemetry.snapshot",
        "summary.updated",
        "report.submitted",
        "report.updated",
        "final_report.generated",
        "final_report.updated",
        "alert.created",
        "alert.updated",
        "alert.resolved",
        "notification.created",
        "notification.updated",
    ):
        assert not can_view_operational_event("admin", event_type)
        assert not can_view_operational_event("staff", event_type)
        assert not can_view_operational_event("enterprise", event_type)


def test_invalidations_are_role_scoped() -> None:
    for role in ("admin", "it", "staff", "enterprise"):
        assert can_view_operational_event(role, "resource.invalidated")


def test_notification_setting_uses_stable_typed_key() -> None:
    assert (
        resolve_system_setting_enabled(
            {NOTIFY_FAILED_LOGIN_LOCKOUT_KEY: False},
            NOTIFY_FAILED_LOGIN_LOCKOUT_KEY,
        )
        is False
    )


def test_notification_setting_ignores_invalid_values() -> None:
    assert (
        resolve_system_setting_enabled(
            {NOTIFY_FAILED_LOGIN_LOCKOUT_KEY: "false"},
            NOTIFY_FAILED_LOGIN_LOCKOUT_KEY,
        )
        is True
    )
