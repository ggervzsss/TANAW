import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

from app.config.camera_config import LocalReportRecordResponse, LocalReportRevisionResponse
from app.storage import resilience_schema
from app.storage.local_metrics_store import LocalMetricsStore
from app.storage.local_schema import connect_local_database, initialize_local_database
from app.storage.resilience_store import (
    SQLiteRetryPolicy,
    SQLiteWriteExhausted,
    run_sqlite_write,
)
from app.storage.session_store import SessionStore

CAMERA_UUID = "b140984a-c738-4ab0-8bd0-d509bab414ba"
JUNE_PERIOD_ID = "month:Asia/Manila:2026-06"


class ResilienceLedgerTest(unittest.TestCase):
    def test_enterprise_camera_and_current_state_are_normalized(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalMetricsStore(directory, enterprise_id="enterprise-42")
            store.append_count_event(
                _event(central_camera_id=CAMERA_UUID),
                "2026-06-15T04:00:00+00:00",
            )
            store.save_camera_live_state(
                {
                    "camera_id": 1,
                    "camera_name": "Entrance",
                    "central_camera_id": CAMERA_UUID,
                    "running": True,
                    "status": "running",
                    "counts": {"entry": 8, "exit": 3, "occupancy": 5},
                },
                "2026-06-15T04:00:01+00:00",
            )

            with closing(connect_local_database(store._database_path)) as connection:
                site = connection.execute("select * from local_sites").fetchone()
                camera = connection.execute("select * from local_cameras").fetchone()
                live = connection.execute("select * from camera_live_state").fetchone()
                event = connection.execute("select * from count_events").fetchone()
                camera_owned_tables = {
                    table: {
                        row["table"]
                        for row in connection.execute(f"pragma foreign_key_list({table})")
                    }
                    for table in (
                        "count_events",
                        "local_camera_event_sequences",
                        "monitoring_sessions",
                        "coverage_gaps",
                        "metric_rollups",
                    )
                }

            self.assertEqual(site["enterprise_id"], "enterprise-42")
            self.assertEqual(camera["local_site_id"], site["local_site_id"])
            self.assertEqual(camera["central_camera_id"], CAMERA_UUID)
            self.assertEqual(live["camera_key"], camera["camera_key"])
            self.assertEqual(
                (live["state"], live["entry_count"], live["exit_count"], live["occupancy_count"]),
                ("running", 8, 3, 5),
            )
            self.assertEqual(event["camera_key"], camera["camera_key"])
            self.assertEqual(event["payload_schema_version"], 1)
            for owners in camera_owned_tables.values():
                self.assertIn("local_cameras", owners)

    def test_coverage_gaps_are_persisted_and_projected_to_strict_report_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalMetricsStore(directory)
            store.start_monitoring_session(
                monitoring_session_id="session-1",
                camera_id=1,
                camera_name="Entrance",
                central_camera_id=CAMERA_UUID,
                started_at="2026-06-01T00:00:00+00:00",
            )
            store.record_coverage_gap(
                monitoring_session_id="session-1",
                camera_id=1,
                camera_name="Entrance",
                central_camera_id=CAMERA_UUID,
                started_at="2026-06-01T00:00:00+00:00",
                reason="initial_connection",
                recoverable=True,
            )
            store.mark_monitoring_connected("session-1", "2026-06-01T00:00:10+00:00")
            store.record_coverage_gap(
                monitoring_session_id="session-1",
                camera_id=1,
                camera_name="Entrance",
                central_camera_id=CAMERA_UUID,
                started_at="2026-06-01T00:00:20+00:00",
                reason="frame_read_timeout",
                recoverable=True,
            )
            store.mark_monitoring_connected("session-1", "2026-06-01T00:00:30+00:00")
            store.end_monitoring_session(
                "session-1",
                ended_at="2026-06-01T00:00:40+00:00",
                reason="operator_stopped",
            )
            store.append_count_event(
                _event(central_camera_id=CAMERA_UUID),
                "2026-06-15T04:00:00+00:00",
            )

            local_coverage = store.monitoring_coverage(
                JUNE_PERIOD_ID, as_of="2026-07-01T00:00:00+00:00"
            )
            submission = store.create_local_report_revision("REP-COVERAGE", JUNE_PERIOD_ID)
            outbox = store.list_ready_sync_outbox_items()[0]
            payload = outbox["payload"]["payload"]
            contract_coverage = payload["coverage"]

            self.assertEqual(local_coverage["expectedSeconds"], 40.0)
            self.assertEqual(local_coverage["monitoredSeconds"], 20.0)
            self.assertEqual(local_coverage["gapCount"], 2)
            self.assertEqual(
                submission["coverage"]["warnings"],
                ["Monitoring coverage is incomplete; review the recorded camera gaps."],
            )
            self.assertEqual(
                set(contract_coverage),
                {"evidenceStatus", "monitoredSeconds", "expectedSeconds", "gaps"},
            )
            self.assertIsInstance(contract_coverage["monitoredSeconds"], int)
            self.assertIsInstance(contract_coverage["expectedSeconds"], int)
            self.assertEqual(
                contract_coverage["monitoredSeconds"]
                + sum(gap["durationSeconds"] for gap in contract_coverage["gaps"]),
                contract_coverage["expectedSeconds"],
            )
            for gap in contract_coverage["gaps"]:
                self.assertEqual(set(gap), {"reason", "durationSeconds"})
            for metric in payload["metrics"]:
                self.assertEqual(
                    set(metric["coverage"]),
                    {"evidenceStatus", "monitoredSeconds", "expectedSeconds", "gapCount"},
                )
                self.assertEqual(metric["coverage"]["gapCount"], 2)
                self.assertEqual(metric["quality"], "degraded")

    def test_event_and_rollups_commit_once_and_raw_purge_retains_nonidentifying_history(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalMetricsStore(directory)
            store.upsert_visitor_identity(
                visitor_id="visitor-1",
                business_date="2026-06-15",
                camera_id=1,
                embedding=b"private-embedding",
                embedding_dim=2,
                embedding_count=1,
                model_name="test",
                expires_at="2026-06-16T00:00:00+00:00",
                recorded_at="2026-06-15T04:00:00+00:00",
            )
            store.append_visitor_sighting(
                {
                    "visitor_id": "visitor-1",
                    "business_date": "2026-06-15",
                    "camera_id": 1,
                    "track_id": 1,
                    "direction": "entry",
                    "reid_decision": "new",
                    "identity_confidence": "high",
                },
                "2026-06-15T04:00:00+00:00",
            )
            event = _event(central_camera_id=CAMERA_UUID)
            event["visitor_id"] = "visitor-1"
            store.append_count_event(event, "2026-06-15T04:00:00+00:00")
            store.save_camera_live_state(
                {
                    "camera_id": 1,
                    "camera_name": "Entrance",
                    "running": True,
                    "counts": {"entry": 1, "exit": 0, "occupancy": 1},
                },
                "2026-06-15T04:00:01+00:00",
            )
            store.create_local_report_revision("REP-PURGE", JUNE_PERIOD_ID)

            purged = store.purge_report_raw_events("REP-PURGE")

            self.assertEqual(purged["purged_events"], 1)
            self.assertEqual(purged["purged_sightings"], 1)
            self.assertEqual(purged["purged_identities"], 1)
            self.assertEqual(
                store.metrics_summary(include_submitted=True, period_id=JUNE_PERIOD_ID)["entries"],
                1,
            )
            self.assertEqual(
                store.metrics_history(
                    include_submitted=True,
                    period_id=JUNE_PERIOD_ID,
                    now=datetime(2026, 6, 15, 23, 0, tzinfo=UTC),
                )["hourly_density"][4]["entry"],
                1,
            )
            with closing(connect_local_database(store._database_path)) as connection:
                counts = {
                    table: connection.execute(f"select count(*) from {table}").fetchone()[0]
                    for table in (
                        "count_events",
                        "camera_live_state",
                        "visitor_identities",
                        "visitor_sightings",
                    )
                }
                rollups = connection.execute(
                    "select grain, entries from metric_rollups order by grain"
                ).fetchall()
            self.assertEqual(
                counts,
                {
                    "count_events": 0,
                    "camera_live_state": 1,
                    "visitor_identities": 0,
                    "visitor_sightings": 0,
                },
            )
            self.assertEqual(
                [(row["grain"], row["entries"]) for row in rollups],
                [
                    ("day", 1),
                    ("hour", 1),
                ],
            )

    def test_duplicate_jsonl_is_migrated_once_then_removed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            event_path = Path(directory) / "ml-service" / "events.jsonl"
            event_path.parent.mkdir(parents=True)
            event_path.write_text(
                json.dumps(
                    {
                        **_event(),
                        "recorded_at": "2026-06-15T04:00:00+00:00",
                    }
                )
                + "\n",
                encoding="utf-8",
            )

            first = SessionStore(directory)
            second = SessionStore(directory)

            self.assertFalse(event_path.exists())
            self.assertEqual(first.metrics_summary(include_submitted=True)["entries"], 1)
            self.assertEqual(second.metrics_summary(include_submitted=True)["total_events"], 1)

    def test_sqlite_busy_failures_are_retried_with_a_hard_bound(self) -> None:
        attempts = 0
        sleeps: list[float] = []

        def eventually_succeeds() -> str:
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise sqlite3.OperationalError("database is locked")
            return "written"

        result = run_sqlite_write(
            "test_write",
            eventually_succeeds,
            policy=SQLiteRetryPolicy(
                maximum_attempts=4,
                initial_delay_seconds=0.1,
                maximum_delay_seconds=0.2,
            ),
            sleep=sleeps.append,
        )

        self.assertEqual(result, "written")
        self.assertEqual(attempts, 3)
        self.assertEqual(sleeps, [0.1, 0.2])

        with self.assertRaises(SQLiteWriteExhausted) as raised:
            run_sqlite_write(
                "poison_write",
                lambda: (_ for _ in ()).throw(sqlite3.OperationalError("database is busy")),
                policy=SQLiteRetryPolicy(maximum_attempts=2),
                sleep=lambda _delay: None,
            )
        self.assertEqual(raised.exception.attempts, 2)

        with tempfile.TemporaryDirectory() as directory:
            store = LocalMetricsStore(directory)
            error_id = store.record_persistence_error(
                operation=raised.exception.operation,
                reason="sqlite_busy_exhausted",
                detail=str(raised.exception.original_error),
                attempt_count=raised.exception.attempts,
                occurred_at="2026-06-15T04:00:00+00:00",
            )
            diagnostics = store.list_persistence_errors()
        self.assertEqual([row["persistence_error_id"] for row in diagnostics], [error_id])
        self.assertEqual(diagnostics[0]["attempt_count"], 2)

    def test_outbox_schema_uses_only_integer_contract_version_two(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalMetricsStore(directory)
            store.append_count_event(
                _event(central_camera_id=CAMERA_UUID),
                "2026-06-15T04:00:00+00:00",
            )
            submission = store.create_local_report_revision("REP-CONTRACT", JUNE_PERIOD_ID)

            item = store.list_ready_sync_outbox_items()[0]
            submitted_response = LocalReportRevisionResponse(**submission)
            listed_response = LocalReportRecordResponse(**store.list_local_reports()[0])
            with closing(connect_local_database(store._database_path)) as connection:
                column = next(
                    row
                    for row in connection.execute("pragma table_info(sync_outbox_items)")
                    if row["name"] == "contract_version"
                )

            self.assertEqual(item["contract_version"], 2)
            self.assertEqual(str(column["type"]).upper(), "INTEGER")
            self.assertEqual(submitted_response.outbox_item_id, item["outbox_item_id"])
            self.assertEqual(listed_response.outbox_item_id, item["outbox_item_id"])
            self.assertEqual(listed_response.revision_id, item["report_revision_id"])
            self.assertEqual(listed_response.payload_hash, item["payload_hash"])

    def test_unknown_legacy_outbox_contract_is_dead_lettered_during_v4_upgrade(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(
                resilience_schema,
                "_normalize_report_outbox_contract_version",
                return_value=None,
            ):
                store = LocalMetricsStore(directory)
                store.append_count_event(
                    _event(central_camera_id=CAMERA_UUID),
                    "2026-06-15T04:00:00+00:00",
                )
                store.create_local_report_revision("REP-UNKNOWN-CONTRACT", JUNE_PERIOD_ID)
            with closing(sqlite3.connect(store._database_path)) as connection:
                connection.execute(
                    "update sync_outbox_items set contract_version = 'future-contract.v9'"
                )
                connection.execute("delete from local_schema_migrations where version = 4")
                connection.execute("pragma user_version = 3")
                connection.commit()

            initialize_local_database(store._database_path)

            with closing(connect_local_database(store._database_path)) as connection:
                item = connection.execute("select * from sync_outbox_items").fetchone()
            self.assertEqual(item["contract_version"], 2)
            self.assertEqual(item["status"], "dead_letter")
            self.assertEqual(item["last_error_class"], "unsupported_legacy_contract_version")


def _event(*, central_camera_id: str | None = None) -> dict:
    payload = {
        "camera_id": 1,
        "camera_name": "Entrance",
        "direction": "entry",
        "track_id": 1,
        "is_unique_entry": True,
        "counts": {"entry": 1, "exit": 0, "occupancy": 1},
        "source_kind": "real",
    }
    if central_camera_id is not None:
        payload["central_camera_id"] = central_camera_id
    return payload
