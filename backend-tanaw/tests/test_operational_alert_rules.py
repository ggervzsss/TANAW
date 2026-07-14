from app.features.operational.service import (
    NOTIFY_FAILED_LOGIN_LOCKOUT_KEY,
    can_view_operational_event,
    resolve_system_setting_enabled,
)


def test_it_receives_live_alert_websocket_events() -> None:
    assert can_view_operational_event("it", "alert.created")
    assert can_view_operational_event("it", "alert.updated")
    assert can_view_operational_event("it", "alert.resolved")


def test_websocket_authorization_rejects_removed_event_contracts() -> None:
    for event_type in (
        "telemetry.snapshot",
        "summary.updated",
        "report.submitted",
        "report.updated",
        "final_report.generated",
        "final_report.updated",
    ):
        assert not can_view_operational_event("admin", event_type)
        assert not can_view_operational_event("staff", event_type)
        assert not can_view_operational_event("enterprise", event_type)


def test_target_notifications_and_invalidations_are_role_scoped() -> None:
    for role in ("admin", "it", "staff", "enterprise"):
        assert can_view_operational_event(role, "notification.created")
        assert can_view_operational_event(role, "resource.invalidated")
    assert not can_view_operational_event("staff", "alert.created")
    assert not can_view_operational_event("enterprise", "alert.created")


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
