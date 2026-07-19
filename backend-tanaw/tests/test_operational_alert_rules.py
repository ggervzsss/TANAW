from datetime import UTC, datetime

from app.features.operational.models import EnterpriseTelemetrySnapshot
from app.features.operational.schemas import (
    DesktopMetricsSummary,
    DesktopTelemetryIngest,
)
from app.features.operational.service import (
    NOTIFY_GATEWAY_SERVICE_ERROR_KEY,
    NOTIFY_SYNC_DELAY_KEY,
    can_view_operational_event,
    gateway_status_for_snapshot,
    occupancy_alert_condition,
    resolve_system_setting_enabled,
)


def test_telemetry_without_building_capacity_has_no_occupancy_rule() -> None:
    payload = DesktopTelemetryIngest(
        metrics=DesktopMetricsSummary(currentOccupancy=500),
    )

    assert occupancy_alert_condition(payload) is None


def test_real_telemetry_uses_building_capacity_for_alert_condition() -> None:
    payload = DesktopTelemetryIngest(
        metrics=DesktopMetricsSummary(currentOccupancy=180),
    )

    condition = occupancy_alert_condition(payload, building_capacity=200)

    assert condition is not None
    assert condition.capacity == 200
    assert condition.threshold_percent == 90
    assert condition.threshold_count == 180
    assert condition.breached is True


def test_it_receives_live_alert_websocket_events() -> None:
    assert can_view_operational_event("it", "alert.created")
    assert can_view_operational_event("it", "alert.updated")
    assert can_view_operational_event("it", "alert.resolved")


def test_unsynced_gateway_snapshot_is_reported_as_sync_delayed() -> None:
    snapshot = EnterpriseTelemetrySnapshot(
        enterprise_profile_id="account-1",
        enterprise_name="Enterprise One",
        captured_at=datetime.now(UTC),
        entries=10,
        exits=2,
        current_occupancy=8,
        peak_occupancy=8,
        unique_count=8,
        confirmed_unique_count=8,
        degraded_unique_count=0,
        total_events=12,
        unsubmitted_events=0,
        unsynced_events=3,
        running=True,
        status="sync_delayed",
    )
    snapshot.received_at = datetime.now(UTC)

    assert gateway_status_for_snapshot(snapshot) == "Sync Delayed"


def test_notification_setting_uses_stable_key_value() -> None:
    assert (
        resolve_system_setting_enabled(
            {NOTIFY_SYNC_DELAY_KEY: False},
            NOTIFY_SYNC_DELAY_KEY,
        )
        is False
    )


def test_notification_setting_ignores_invalid_values() -> None:
    assert (
        resolve_system_setting_enabled(
            {NOTIFY_GATEWAY_SERVICE_ERROR_KEY: "false"},
            NOTIFY_GATEWAY_SERVICE_ERROR_KEY,
        )
        is True
    )
