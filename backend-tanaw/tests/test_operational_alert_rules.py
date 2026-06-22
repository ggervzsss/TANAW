from datetime import UTC, datetime

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.operational.models import EnterpriseTelemetrySnapshot
from app.features.operational.schemas import (
    DesktopMetricsSummary,
    DesktopTelemetryIngest,
    FleetSimulationTarget,
)
from app.features.operational.service import (
    build_fleet_simulation_telemetry_payload,
    can_view_operational_event,
    gateway_status_for_snapshot,
    occupancy_alert_condition,
)


def test_simulation_occupancy_threshold_is_calculated_from_capacity() -> None:
    payload = DesktopTelemetryIngest(
        metrics=DesktopMetricsSummary(currentOccupancy=90),
        sourceKind="mock",
        mockRunId="simulation-run",
        payload={
            "simulation": {
                "capacity": 100,
                "thresholdPercent": 90,
            }
        },
    )

    condition = occupancy_alert_condition(payload)

    assert condition is not None
    assert condition.threshold_count == 90
    assert condition.recovery_count == 80
    assert condition.breached is True
    assert condition.recovered is False


def test_simulation_occupancy_alert_uses_hysteresis_for_recovery() -> None:
    payload = DesktopTelemetryIngest(
        metrics=DesktopMetricsSummary(currentOccupancy=79),
        payload={
            "simulation": {
                "capacity": 100,
                "thresholdPercent": 90,
            }
        },
    )

    condition = occupancy_alert_condition(payload)

    assert condition is not None
    assert condition.breached is False
    assert condition.recovered is True


def test_ordinary_telemetry_has_no_simulation_capacity_rule() -> None:
    payload = DesktopTelemetryIngest(
        metrics=DesktopMetricsSummary(currentOccupancy=500),
        sourceKind="real",
    )

    assert occupancy_alert_condition(payload) is None


def test_it_receives_live_alert_websocket_events() -> None:
    assert can_view_operational_event("it", "alert.created")
    assert can_view_operational_event("it", "alert.updated")
    assert can_view_operational_event("it", "alert.resolved")


def test_fleet_breach_lane_holds_threshold_then_recovers() -> None:
    enterprise = enterprise_account()
    target = FleetSimulationTarget(
        enterpriseId="ent-001",
        lane="one-minute-breach",
        capacity=100,
        thresholdPercent=90,
    )

    breached = build_fleet_simulation_telemetry_payload(
        target=target,
        enterprise=enterprise,
        run_id="fleet-test",
        started_at=datetime.now(UTC),
        elapsed_seconds=60,
    )
    recovered = build_fleet_simulation_telemetry_payload(
        target=target,
        enterprise=enterprise,
        run_id="fleet-test",
        started_at=datetime.now(UTC),
        elapsed_seconds=125,
    )

    assert breached.metrics.currentOccupancy >= 90
    assert recovered.metrics.currentOccupancy <= 80


def test_fleet_warning_lane_reports_sync_delay_without_threshold_breach() -> None:
    enterprise = enterprise_account()
    target = FleetSimulationTarget(
        enterpriseId="ent-001",
        lane="warning",
        capacity=100,
        thresholdPercent=90,
    )

    payload = build_fleet_simulation_telemetry_payload(
        target=target,
        enterprise=enterprise,
        run_id="fleet-test",
        started_at=datetime.now(UTC),
        elapsed_seconds=30,
    )

    condition = occupancy_alert_condition(payload)

    assert payload.metrics.currentOccupancy < 90
    assert payload.metrics.unsyncedEvents > 0
    assert condition is not None
    assert condition.breached is False


def test_unsynced_gateway_snapshot_is_reported_as_sync_delayed() -> None:
    snapshot = EnterpriseTelemetrySnapshot(
        enterprise_account_id="account-1",
        enterprise_id="ent-001",
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


def enterprise_account() -> Account:
    return Account(
        id="account-1",
        email="enterprise@example.com",
        password_hash="hash",
        role=AccountRole.ENTERPRISE,
        display_name="Enterprise One",
        title="Enterprise",
        status=AccountStatus.ACTIVE,
        enterprise_id="ent-001",
        enterprise_name="Enterprise One",
    )
