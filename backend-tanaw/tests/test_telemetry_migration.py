import runpy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast


def test_legacy_payload_hash_is_stable_and_covers_telemetry_facts() -> None:
    migration = _migration()
    payload_hash = migration["_legacy_payload_hash"]
    row = _legacy_row()

    assert payload_hash(row) == payload_hash(dict(row))
    changed = dict(row)
    changed["current_occupancy"] = 8
    assert payload_hash(row) != payload_hash(changed)
    assert len(payload_hash(row)) == 71


def test_resolvable_snapshot_becomes_history_with_health_and_blocking_exceptions() -> None:
    migration = _migration()
    topology = migration["_Topology"](
        enterprise_id="d8d39ea2-10e3-4c88-b71d-5b88c145f8f5",
        site_id="e50f40ec-0208-4eb4-bbe1-e1cb85653ba6",
        classification="official",
        official_code="ENT-001",
        device_ids=("59d18bcf-e5bb-4ab0-9639-60bf80109ebc",),
    )
    connection = _RecordingConnection()

    migration["_backfill_snapshot"](cast(Any, connection), _legacy_row(), topology)

    assert connection.count_inserts("telemetry_observations") == 1
    assert connection.count_inserts("telemetry_metric_facts") == 5
    assert connection.count_inserts("device_health_samples") == 1
    assert connection.count_inserts("site_live_state") == 0
    assert connection.count_inserts("device_telemetry_epochs") == 0
    assert connection.exception_codes() == {
        "missing_camera_lineage",
        "missing_epoch_sequence_evidence",
        "missing_metric_coverage",
        "untrusted_legacy_sync_backlog",
    }
    observation = connection.parameters_for("telemetry_observations")[0]
    assert observation["classification"] == "official"
    assert observation["observed_at"] == _legacy_row()["captured_at"]
    assert observation["received_at"] == _legacy_row()["received_at"]
    metric_insert = str(migration["_METRIC_FACT_INSERT"])
    assert "'legacy_unspecified'" in metric_insert
    assert "metric_window_start" not in metric_insert


def test_migration_is_chained_idempotent_and_database_guarded() -> None:
    migration = _migration()
    source = _migration_path().read_text()

    assert migration["revision"] == "20260713_0022"
    assert migration["down_revision"] == "20260713_0021"
    for statement_name in (
        "_OBSERVATION_INSERT",
        "_METRIC_FACT_INSERT",
        "_HEALTH_INSERT",
        "_EXCEPTION_INSERT",
    ):
        assert "ON CONFLICT (id) DO NOTHING" in str(migration[statement_name])
    assert "tanaw_guard_device_telemetry_epoch" in source
    assert "tanaw_guard_site_live_state_monotonic" in source
    assert "Older telemetry cannot replace current site state" in source
    assert "tanaw_reject_append_only_update" in source
    assert "tanaw_guard_domain_event_delivery" in source
    assert "tanaw_validate_domain_event_consumer_receipt" in source
    assert "CREATE TABLE final_report" not in source
    assert "final_reports_v2" not in source


class _RecordingConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []

    def execute(self, statement: object, parameters: dict[str, object] | None = None) -> None:
        self.calls.append((str(statement), parameters or {}))

    def count_inserts(self, table_name: str) -> int:
        marker = f"INSERT INTO {table_name}"
        return sum(marker in statement for statement, _parameters in self.calls)

    def parameters_for(self, table_name: str) -> list[dict[str, object]]:
        marker = f"INSERT INTO {table_name}"
        return [parameters for statement, parameters in self.calls if marker in statement]

    def exception_codes(self) -> set[object]:
        return {
            parameters["exception_code"]
            for statement, parameters in self.calls
            if "INSERT INTO telemetry_migration_exceptions" in statement
        }


def _migration() -> dict[str, Any]:
    return runpy.run_path(str(_migration_path()))


def _migration_path() -> Path:
    return (
        Path(__file__).resolve().parents[1]
        / "alembic"
        / "versions"
        / "20260713_0022_sequenced_telemetry_and_domain_events.py"
    )


def _legacy_row() -> dict[str, object]:
    captured_at = datetime(2026, 7, 13, 3, 59, tzinfo=UTC)
    received_at = datetime(2026, 7, 13, 4, tzinfo=UTC)
    return {
        "id": "4c0b9622-7ef9-4a97-a557-0b7eab4f6a43",
        "enterprise_account_id": "7be13696-d85c-48f3-a9e1-5395e2dd97eb",
        "enterprise_id": "ENT-001",
        "enterprise_name": "Sample Enterprise",
        "camera_id": "camera-legacy-1",
        "camera_name": "Front door",
        "captured_at": captured_at,
        "received_at": received_at,
        "entries": 12,
        "exits": 7,
        "current_occupancy": 5,
        "peak_occupancy": 8,
        "unique_count": 11,
        "confirmed_unique_count": 9,
        "degraded_unique_count": 2,
        "total_events": 19,
        "unsubmitted_events": 0,
        "unsynced_events": 3,
        "running": True,
        "status": "running",
        "error": None,
        "analytics_fps": 24.5,
        "payload_json": '{"cameraId":"camera-legacy-1"}',
        "source_kind": "real",
        "mock_run_id": None,
    }
