import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import UTC, datetime

from app.config.camera_config import LocalReportRecordResponse, LocalReportRevisionResponse
from app.storage.local_ledger import LocalLedger
from app.storage.local_schema import connect_local_database
from app.storage.sqlite_retry import (
    SQLiteRetryPolicy,
    SQLiteWriteExhausted,
    run_sqlite_write,
)

CAMERA_UUID = "b140984a-c738-4ab0-8bd0-d509bab414ba"
JUNE_PERIOD_ID = "month:Asia/Manila:2026-06"


class ResilienceLedgerTest(unittest.TestCase):
    def test_enterprise_camera_and_current_state_are_normalized(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(directory, enterprise_id="enterprise-42")
            store.append_count_event(
                _event(central_camera_id=CAMERA_UUID),
                "2026-06-15T04:00:00+00:00",
            )
            store.save_runtime_snapshot(
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
            store = LocalLedger(directory)
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
            store = LocalLedger(directory)
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
            store.save_runtime_snapshot(
                {
                    "camera_id": 1,
                    "camera_name": "Entrance",
                    "running": True,
                    "counts": {"entry": 1, "exit": 0, "occupancy": 1},
                },
                "2026-06-15T04:00:01+00:00",
            )
            revision = store.create_local_report_revision("REP-PURGE", JUNE_PERIOD_ID)
            store.acknowledge_sync_outbox_item(str(revision["outbox_item_id"]))

            purged = store.purge_report_raw_events(
                "REP-PURGE",
                str(revision["revision_id"]),
            )

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
            store = LocalLedger(directory)
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

    def test_one_instrumented_writer_connection_is_shared_per_enterprise_ledger(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first = LocalLedger(directory, enterprise_id="enterprise-42")
            second = LocalLedger(directory, enterprise_id="enterprise-42")

            first.append_count_event(
                _event(central_camera_id=CAMERA_UUID),
                "2026-06-15T04:00:00+00:00",
            )
            second.append_count_event(
                _event(central_camera_id=CAMERA_UUID),
                "2026-06-15T04:00:01+00:00",
            )

            instrumentation = first.persistence_instrumentation()

            self.assertEqual(instrumentation["connection_open_count"], 1)
            self.assertEqual(instrumentation["maximum_concurrent_writers"], 1)
            self.assertEqual(instrumentation["active_writer_count"], 0)
            self.assertGreaterEqual(instrumentation["committed_transaction_count"], 2)
            self.assertEqual(instrumentation["rolled_back_transaction_count"], 0)

    def test_runtime_snapshot_and_typed_live_state_roll_back_as_one_transaction(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(directory)
            store.ensure_initialized()
            with closing(connect_local_database(store._database_path)) as connection:
                connection.execute(
                    """
                    create trigger reject_runtime_snapshot
                    before insert on camera_runtime_state
                    begin
                        select raise(abort, 'simulated runtime snapshot failure');
                    end
                    """
                )
                connection.commit()

            with self.assertRaisesRegex(sqlite3.IntegrityError, "simulated runtime snapshot"):
                store.save_runtime_snapshot(
                    {
                        "camera_id": 1,
                        "camera_name": "Entrance",
                        "running": True,
                        "status": "running",
                        "counts": {"entry": 1, "exit": 0, "occupancy": 1},
                    },
                    "2026-06-15T04:00:01+00:00",
                )

            with closing(connect_local_database(store._database_path)) as connection:
                counts = {
                    table: connection.execute(f"select count(*) from {table}").fetchone()[0]
                    for table in ("local_cameras", "camera_live_state", "camera_runtime_state")
                }
            self.assertEqual(
                counts,
                {"local_cameras": 0, "camera_live_state": 0, "camera_runtime_state": 0},
            )

    def test_expired_identity_cleanup_removes_every_embedding_copy_but_keeps_rollups(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(directory)
            store.upsert_visitor_identity(
                visitor_id="visitor-expired",
                business_date="2026-06-15",
                camera_id=1,
                embedding=b"private-embedding",
                embedding_dim=2,
                embedding_count=1,
                model_name="fast",
                expires_at="2026-06-16T02:00:00+00:00",
                recorded_at="2026-06-15T04:00:00+00:00",
            )
            store.upsert_visitor_model_embedding(
                visitor_id="visitor-expired",
                model_name="quality",
                embedding=b"private-quality-embedding",
                embedding_dim=2,
                embedding_count=1,
                recorded_at="2026-06-15T04:00:00+00:00",
            )
            store.append_visitor_sighting(
                {
                    "visitor_id": "visitor-expired",
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
            event["visitor_id"] = "visitor-expired"
            store.append_count_event(event, "2026-06-15T04:00:00+00:00")

            removed = store.cleanup_expired_visitor_metadata("2026-06-16T02:00:01+00:00")
            inventory = store.retention_inventory()
            with closing(connect_local_database(store._database_path)) as connection:
                event_visitor_id = connection.execute(
                    "select visitor_id from count_events"
                ).fetchone()[0]
                rollup_count = connection.execute("select count(*) from metric_rollups").fetchone()[
                    0
                ]

            self.assertEqual(removed, 1)
            self.assertEqual(event_visitor_id, None)
            self.assertEqual(rollup_count, 2)
            self.assertEqual(
                inventory["raw_table_counts"],
                {
                    "count_events": 1,
                    "visitor_identities": 0,
                    "visitor_model_embeddings": 0,
                    "visitor_sightings": 0,
                },
            )
            self.assertEqual(inventory["forbidden_disk_artifacts"], [])

    def test_raw_purge_requires_acknowledged_exact_consolidated_revision(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(directory)
            store.append_count_event(
                _event(central_camera_id=CAMERA_UUID),
                "2026-06-15T04:00:00+00:00",
            )
            revision = store.create_local_report_revision("REP-GUARDED", JUNE_PERIOD_ID)

            with self.assertRaisesRegex(ValueError, "central acknowledgement"):
                store.purge_report_raw_events("REP-GUARDED", str(revision["revision_id"]))
            store.acknowledge_sync_outbox_item(str(revision["outbox_item_id"]))
            with self.assertRaisesRegex(ValueError, "does not match"):
                store.purge_report_raw_events(
                    "REP-GUARDED",
                    "11111111-1111-4111-8111-111111111111",
                )

            result = store.purge_report_raw_events(
                "REP-GUARDED",
                str(revision["revision_id"]),
            )

            self.assertEqual(result["revision_id"], revision["revision_id"])
            self.assertEqual(result["purged_events"], 1)

    def test_outbox_schema_uses_only_integer_contract_version_two(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(directory)
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
