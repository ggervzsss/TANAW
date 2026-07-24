from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.features.accounts.models import Account, AccountRole, AccountStatus
from app.features.operational.models import (
    EnterpriseTelemetrySnapshot,
    OperationalAlert,
    UserNotification,
)
from app.features.operational.router import enterprise_status_from_telemetry
from app.features.operational.schemas import TelemetrySnapshotSummary, VisitorInsightPoint
from app.features.operational.service import (
    NOTIFY_GATEWAY_SERVICE_ERROR_KEY,
    NOTIFY_SYNC_DELAY_KEY,
    HourlyVisitorObservation,
    can_manage_operational_alert,
    can_view_operational_event,
    create_role_notifications,
    gateway_status_for_snapshot,
    list_operational_alerts,
    resolve_system_setting_enabled,
    to_operational_alert_summary,
    visitor_activity_condition,
    visitor_baselines_by_enterprise,
    visitor_enterprise_insight,
    visitor_insight_series,
)


@pytest.mark.parametrize(
    ("stored_severity", "urgency"),
    [("Info", "Normal"), ("Warning", "Important"), ("Critical", "Urgent")],
)
def test_operational_alert_api_exposes_canonical_urgency(
    stored_severity: str, urgency: str
) -> None:
    alert = OperationalAlert(
        id="ALT-URGENCY",
        alert_code="ALT-URGENCY",
        alert_type="Maintenance Request",
        owner="IT",
        severity=stored_severity,
        status="New",
        enterprise="Enterprise One",
        requester="Enterprise One",
        summary="Camera unavailable",
        required_action="Check the camera connection.",
        resolution_mode="Remote Review",
        created_at=datetime.now(UTC),
    )

    summary = to_operational_alert_summary(alert)

    assert summary.urgency == urgency
    assert summary.severity == stored_severity


def test_visitor_activity_requires_three_matching_baseline_days() -> None:
    assert visitor_activity_condition(50, [20, 22]) is None


def test_visitor_activity_compares_current_level_with_matching_history() -> None:
    condition = visitor_activity_condition(48, [19, 20, 21, 20])

    assert condition is not None
    assert condition.typical_occupancy == 20
    assert condition.baseline_days == 4
    assert condition.threshold_count == 30
    assert condition.recovery_count == 24
    assert condition.breached is True
    assert condition.difference_percent == 140


def test_visitor_baseline_uses_matching_weekday_and_hour() -> None:
    local_now = datetime(2026, 7, 21, 16, tzinfo=UTC)
    observations = [
        _hourly_observation("enterprise-1", local_now - timedelta(days=7), 20),
        _hourly_observation("enterprise-1", local_now - timedelta(days=14), 22),
        _hourly_observation("enterprise-1", local_now - timedelta(days=21), 18),
        _hourly_observation("enterprise-1", local_now - timedelta(days=1), 99),
    ]

    assert visitor_baselines_by_enterprise(observations, local_now) == {
        "enterprise-1": [20, 22, 18]
    }


def test_visitor_insight_series_combines_establishments_by_day() -> None:
    local_now = datetime(2026, 7, 21, 16, tzinfo=UTC)
    observations = [
        _hourly_observation("enterprise-1", local_now - timedelta(days=1), 20),
        _hourly_observation("enterprise-1", local_now - timedelta(days=1, hours=2), 30),
        _hourly_observation("enterprise-2", local_now - timedelta(days=1), 10),
        _hourly_observation("enterprise-2", local_now - timedelta(days=1, hours=2), 20),
    ]

    points = visitor_insight_series(observations, "7d", local_now)

    point_day = (local_now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    assert points == [
        VisitorInsightPoint(
            startAt=point_day,
            label=point_day.strftime("%a, %b %d").replace(" 0", " "),
            averageVisitors=40,
            peakVisitors=50,
        )
    ]


def test_enterprise_insight_marks_unusual_activity() -> None:
    telemetry = TelemetrySnapshotSummary(
        id="snapshot-1",
        enterpriseId="enterprise-1",
        enterpriseName="Enterprise One",
        barangay="Nueva",
        capturedAt=datetime.now(UTC),
        receivedAt=datetime.now(UTC),
        entries=100,
        exits=55,
        currentOccupancy=45,
        peakOccupancy=45,
        uniqueCount=70,
        confirmedUniqueCount=60,
        degradedUniqueCount=10,
        totalEvents=155,
        unsubmittedEvents=0,
        unsyncedEvents=0,
        running=True,
        status="running",
        gatewayStatus="Connected",
    )

    insight = visitor_enterprise_insight(telemetry, [20, 21, 19, 20])

    assert insight.activityLevel == "Busier Than Usual"
    assert insight.typicalVisitors == 20
    assert insight.differencePercent == 125


def test_enterprise_map_uses_neutral_status_when_device_is_offline_or_inactive() -> None:
    assert enterprise_status_from_telemetry(None, building_capacity=100) == "Inactive"

    telemetry = _telemetry_summary(gateway_status="Offline")

    assert enterprise_status_from_telemetry(telemetry, building_capacity=100) == "Offline"


@pytest.mark.parametrize(
    (
        "gateway_status",
        "telemetry_status",
        "error",
        "current_occupancy",
        "unsynced_events",
        "expected_status",
    ),
    [
        ("Offline", "error", "Counting service unavailable", 0, 0, "Issue"),
        ("Sync Delayed", "stopped", None, 0, 3, "Issue"),
        ("Connected", "running", None, 100, 0, "High Occupancy"),
        ("Connected", "running", None, 80, 0, "Warning"),
        ("Connected", "running", None, 79, 0, "Normal"),
    ],
)
def test_enterprise_map_status_uses_health_and_capacity(
    gateway_status: str,
    telemetry_status: str,
    error: str | None,
    current_occupancy: int,
    unsynced_events: int,
    expected_status: str,
) -> None:
    telemetry = _telemetry_summary(
        gateway_status=gateway_status,
        status=telemetry_status,
        error=error,
        current_occupancy=current_occupancy,
        unsynced_events=unsynced_events,
    )

    assert enterprise_status_from_telemetry(telemetry, building_capacity=100) == expected_status


def _hourly_observation(
    enterprise_id: str, start_at: datetime, average_visitors: int
) -> HourlyVisitorObservation:
    return HourlyVisitorObservation(
        enterprise_profile_id=f"profile-{enterprise_id}",
        enterprise_id=enterprise_id,
        enterprise_name=enterprise_id,
        barangay="Nueva",
        start_at=start_at,
        average_visitors=average_visitors,
        peak_visitors=average_visitors,
    )


def _telemetry_summary(
    *,
    gateway_status: str,
    status: str = "stopped",
    error: str | None = None,
    current_occupancy: int = 0,
    unsynced_events: int = 0,
) -> TelemetrySnapshotSummary:
    now = datetime.now(UTC)
    return TelemetrySnapshotSummary(
        id="snapshot-status",
        enterpriseId="enterprise-status",
        enterpriseName="Enterprise Status",
        capturedAt=now,
        receivedAt=now,
        entries=0,
        exits=0,
        currentOccupancy=current_occupancy,
        peakOccupancy=0,
        uniqueCount=0,
        confirmedUniqueCount=0,
        degradedUniqueCount=0,
        totalEvents=0,
        unsubmittedEvents=0,
        unsyncedEvents=unsynced_events,
        running=False,
        status=status,
        error=error,
        gatewayStatus=gateway_status,
    )


def test_it_receives_live_alert_websocket_events() -> None:
    assert can_view_operational_event("it", "alert.created")
    assert can_view_operational_event("it", "alert.updated")
    assert can_view_operational_event("it", "alert.resolved")


def test_alert_management_follows_operational_ownership() -> None:
    admin = Account(role=AccountRole.ADMIN)
    it_account = Account(role=AccountRole.IT)
    admin_alert = OperationalAlert(owner="Admin")
    it_alert = OperationalAlert(owner="IT")

    assert can_manage_operational_alert(admin, admin_alert)
    assert not can_manage_operational_alert(admin, it_alert)
    assert can_manage_operational_alert(it_account, it_alert)
    assert not can_manage_operational_alert(it_account, admin_alert)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("role", "visible_owners"),
    [
        (AccountRole.ADMIN, ("Admin", "System")),
        (AccountRole.IT, ("IT", "System")),
    ],
)
async def test_alert_list_is_scoped_to_operational_owner(
    role: AccountRole, visible_owners: tuple[str, str]
) -> None:
    db = MagicMock()
    db.scalars = AsyncMock(return_value=[])

    assert await list_operational_alerts(db, Account(role=role)) == []

    statement = db.scalars.await_args.args[0]
    sql = str(statement.compile(compile_kwargs={"literal_binds": True}))
    for owner in visible_owners:
        assert f"'{owner}'" in sql


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


@pytest.mark.asyncio
async def test_action_notification_reuses_existing_source_record() -> None:
    recipient = Account(
        id="it-1",
        email="it@example.com",
        password_hash="hash",
        role=AccountRole.IT,
        display_name="IT Personnel",
        title="IT Personnel",
        status=AccountStatus.ACTIVE,
        activated_at=datetime.now(UTC),
    )
    existing = UserNotification(
        id="notification-1",
        recipient_account_id=recipient.id,
        recipient_role=recipient.role.value,
        title="Old title",
        message="Old message",
        notification_type="Technical Issue",
        severity="Warning",
        source_type="operational.alert",
        source_id="ALT-1",
        created_at=datetime.now(UTC) - timedelta(hours=1),
        read_at=datetime.now(UTC),
    )
    recipient_result = MagicMock()
    recipient_result.all.return_value = [recipient]
    db = MagicMock()
    db.scalars = AsyncMock(return_value=recipient_result)
    db.scalar = AsyncMock(return_value=existing)
    db.commit = AsyncMock()
    db.refresh = AsyncMock()

    notifications = await create_role_notifications(
        db,
        recipient_roles=[AccountRole.IT],
        title="Updated technical issue",
        message="The latest problem details.",
        notification_type="Technical Issue",
        severity="Critical",
        source_type="operational.alert",
        source_id="ALT-1",
        replace_existing_for_source=True,
    )

    assert len(notifications) == 1
    assert existing.title == "Updated technical issue"
    assert existing.severity == "Critical"
    assert existing.read_at is None
    db.add.assert_not_called()
