import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from typing import Any

from app.storage.local_metrics_store import LocalMetricsStore
from app.storage.local_schema import connect_local_database
from app.storage.report_ledger_schema import canonical_hash

JUNE_PERIOD_ID = "month:Asia/Manila:2026-06"
JULY_PERIOD_ID = "month:Asia/Manila:2026-07"


class LocalReportOutboxTest(unittest.TestCase):
    def test_official_report_rejects_camera_without_central_uuid_binding(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalMetricsStore(directory)
            event = _event("entry")
            event.pop("central_camera_id")
            store.append_count_event(event, "2026-06-10T00:00:00+00:00")

            with self.assertRaisesRegex(ValueError, "central camera UUID"):
                store.record_report_submission("REP-JUNE", JUNE_PERIOD_ID)

            with closing(connect_local_database(_database_path(directory))) as connection:
                self.assertEqual(
                    connection.execute("select count(*) from local_reports").fetchone()[0],
                    0,
                )

    def test_report_revision_membership_batches_and_outbox_commit_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalMetricsStore(directory)
            store.append_count_event(
                _event("entry", camera_id=1, camera_name="North"),
                "2026-06-10T00:00:00+00:00",
            )
            store.append_count_event(
                _event("entry", camera_id=2, camera_name="South"),
                "2026-06-11T00:00:00+00:00",
            )
            store.append_count_event(
                _event("entry", camera_id=1, camera_name="North"),
                "2026-07-01T00:00:00+00:00",
            )

            submission = store.record_report_submission(
                "REP-JUNE",
                JUNE_PERIOD_ID,
                payload={"demo": {"source": "operator"}},
                idempotency_key="submit-june-v1",
                command_id="33333333-3333-4333-8333-333333333333",
            )

            database_path = _database_path(directory)
            with closing(connect_local_database(database_path)) as connection:
                counts = {
                    table: connection.execute(f"select count(*) from {table}").fetchone()[0]
                    for table in (
                        "local_reports",
                        "local_report_revisions",
                        "local_report_source_batches",
                        "local_report_event_memberships",
                        "sync_outbox_items",
                    )
                }
                legacy_writes = connection.execute(
                    "select count(*) from count_events where submitted_report_id is not null"
                ).fetchone()[0]
                camera_sequences = connection.execute(
                    """
                    select camera_key, camera_event_sequence
                    from count_events
                    order by camera_key, camera_event_sequence
                    """
                ).fetchall()
                outbox = connection.execute("select * from sync_outbox_items").fetchone()

            self.assertEqual(
                counts,
                {
                    "local_reports": 1,
                    "local_report_revisions": 1,
                    "local_report_source_batches": 2,
                    "local_report_event_memberships": 2,
                    "sync_outbox_items": 1,
                },
            )
            self.assertEqual(legacy_writes, 0)
            self.assertEqual(
                [tuple(row) for row in camera_sequences],
                [
                    ("11111111-1111-4111-8111-111111111111", 0),
                    ("11111111-1111-4111-8111-111111111111", 1),
                    ("22222222-2222-4222-8222-222222222222", 0),
                ],
            )
            self.assertEqual(submission["revision_number"], 1)
            self.assertEqual(submission["outbox_item_id"], outbox["outbox_item_id"])
            self.assertEqual(submission["payload_hash"], outbox["payload_hash"])
            command = submission_payload(outbox)
            self.assertEqual(
                f"sha256:{canonical_hash(command['payload'])}",
                outbox["payload_hash"],
            )
            self.assertEqual(command["contractVersion"], 2)
            self.assertEqual(command["expectedVersion"], 0)
            self.assertEqual(command["payload"]["periodKey"], JUNE_PERIOD_ID)
            self.assertEqual(
                command["payload"]["sourceWindow"],
                {
                    "start": "2026-05-31T16:00:00Z",
                    "end": "2026-06-30T16:00:00Z",
                },
            )
            for batch in command["payload"]["sourceBatches"]:
                self.assertEqual(
                    batch["eventSequenceEndExclusive"] - batch["eventSequenceStart"],
                    batch["eventCount"],
                )
                self.assertRegex(batch["aggregateHash"], r"^sha256:[0-9a-f]{64}$")
            self.assertEqual(
                command["payload"]["coverage"],
                {
                    "evidenceStatus": "not_recorded",
                    "monitoredSeconds": None,
                    "expectedSeconds": None,
                    "gaps": [],
                },
            )
            self.assertEqual(store.metrics_summary(period_id=JUNE_PERIOD_ID)["entries"], 0)
            self.assertEqual(store.metrics_summary(period_id=JULY_PERIOD_ID)["entries"], 1)

    def test_outbox_insert_failure_rolls_back_report_revision_and_membership(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalMetricsStore(directory)
            store.append_count_event(_event("entry"), "2026-06-10T00:00:00+00:00")
            database_path = _database_path(directory)
            with closing(connect_local_database(database_path)) as connection:
                connection.execute(
                    """
                    create trigger reject_report_outbox
                    before insert on sync_outbox_items
                    begin
                        select raise(abort, 'injected outbox failure');
                    end
                    """
                )

            with self.assertRaisesRegex(sqlite3.IntegrityError, "injected outbox failure"):
                store.record_report_submission("REP-JUNE", JUNE_PERIOD_ID)

            with closing(connect_local_database(database_path)) as connection:
                for table in (
                    "local_reports",
                    "local_report_revisions",
                    "local_report_source_batches",
                    "local_report_event_memberships",
                    "sync_outbox_items",
                ):
                    self.assertEqual(
                        connection.execute(f"select count(*) from {table}").fetchone()[0],
                        0,
                    )
            self.assertEqual(store.metrics_summary(period_id=JUNE_PERIOD_ID)["entries"], 1)

    def test_lost_ack_restart_and_replay_return_the_original_revision(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first_store = LocalMetricsStore(directory)
            first_store.append_count_event(_event("entry"), "2026-06-10T00:00:00+00:00")
            first = first_store.record_report_submission(
                "REP-JUNE",
                JUNE_PERIOD_ID,
                notes="original",
                payload={"demo": {"foreign": 2}},
                idempotency_key="submit-june-v1",
            )

            restarted_store = LocalMetricsStore(directory)
            replay = restarted_store.record_report_submission(
                "REP-JUNE",
                JUNE_PERIOD_ID,
                notes="original",
                payload={"demo": {"foreign": 2}},
                idempotency_key="submit-june-v1",
            )
            ready = restarted_store.list_ready_sync_outbox_items()

            self.assertEqual(replay["revision_id"], first["revision_id"])
            self.assertEqual(replay["outbox_item_id"], first["outbox_item_id"])
            self.assertEqual(len(ready), 1)
            self.assertEqual(ready[0]["outbox_item_id"], first["outbox_item_id"])
            self.assertTrue(
                restarted_store.acknowledge_sync_outbox_item(
                    str(first["outbox_item_id"]),
                    {"serverRevisionId": "server-revision-1"},
                )
            )
            self.assertTrue(
                restarted_store.acknowledge_sync_outbox_item(
                    str(first["outbox_item_id"]),
                    {"serverRevisionId": "server-revision-1"},
                )
            )
            with self.assertRaisesRegex(ValueError, "command ID does not match"):
                restarted_store.acknowledge_sync_outbox_item(
                    str(first["outbox_item_id"]),
                    {"commandId": "99999999-9999-4999-8999-999999999999"},
                )
            self.assertEqual(restarted_store.list_ready_sync_outbox_items(), [])
            self.assertEqual(
                restarted_store.list_report_submissions()[0]["sync_status"],
                "synced",
            )

            with closing(connect_local_database(_database_path(directory))) as connection:
                self.assertEqual(
                    connection.execute("select count(*) from local_report_revisions").fetchone()[0],
                    1,
                )
                self.assertEqual(
                    connection.execute("select count(*) from sync_attempts").fetchone()[0],
                    1,
                )

    def test_idempotency_key_rejects_a_different_request(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalMetricsStore(directory)
            store.append_count_event(_event("entry"), "2026-06-10T00:00:00+00:00")
            store.record_report_submission(
                "REP-JUNE",
                JUNE_PERIOD_ID,
                notes="first",
                idempotency_key="stable-key",
            )

            with self.assertRaisesRegex(ValueError, "different report payload"):
                store.record_report_submission(
                    "REP-JUNE",
                    JUNE_PERIOD_ID,
                    notes="changed",
                    idempotency_key="stable-key",
                )

    def test_new_request_creates_an_immutable_next_revision(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalMetricsStore(directory)
            store.append_count_event(_event("entry"), "2026-06-10T00:00:00+00:00")
            first = store.record_report_submission(
                "REP-JUNE",
                JUNE_PERIOD_ID,
                notes="first",
                idempotency_key="revision-1",
            )
            self.assertTrue(
                store.acknowledge_sync_outbox_item(
                    str(first["outbox_item_id"]),
                    {"resource": {"logicalVersion": 1}},
                )
            )
            second = store.record_report_submission(
                "REP-JUNE",
                JUNE_PERIOD_ID,
                notes="corrected",
                idempotency_key="revision-2",
            )

            self.assertNotEqual(first["revision_id"], second["revision_id"])
            self.assertEqual(second["revision_number"], 2)
            self.assertEqual(store.list_report_submissions()[0]["notes"], "corrected")
            self.assertEqual(
                store.list_report_submissions()[0]["sync_status"],
                "pending_cloud_sync",
            )
            self.assertEqual(
                [item["outbox_item_id"] for item in store.list_ready_sync_outbox_items()],
                [second["outbox_item_id"]],
            )
            with closing(connect_local_database(_database_path(directory))) as connection:
                revisions = connection.execute(
                    """
                    select revision_number, notes
                    from local_report_revisions
                    order by revision_number
                    """
                ).fetchall()
                memberships = connection.execute(
                    """
                    select report_revision_id, count(*) as event_count
                    from local_report_event_memberships
                    group by report_revision_id
                    """
                ).fetchall()
                second_command = submission_payload(
                    connection.execute(
                        "select * from sync_outbox_items where outbox_item_id = ?",
                        (second["outbox_item_id"],),
                    ).fetchone()
                )

            self.assertEqual([tuple(row) for row in revisions], [(1, "first"), (2, "corrected")])
            self.assertEqual(len(memberships), 2)
            self.assertEqual(
                {row["report_revision_id"] for row in memberships},
                {first["revision_id"], second["revision_id"]},
            )
            self.assertEqual(second_command["expectedVersion"], 1)
            self.assertEqual(len(second_command["payload"]["sourceBatches"]), 1)

    def test_report_revision_rows_reject_in_place_updates(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalMetricsStore(directory)
            store.append_count_event(_event("entry"), "2026-06-10T00:00:00+00:00")
            submission = store.record_report_submission("REP-JUNE", JUNE_PERIOD_ID)

            with closing(connect_local_database(_database_path(directory))) as connection:
                with self.assertRaisesRegex(sqlite3.IntegrityError, "immutable"):
                    connection.execute(
                        """
                        update local_report_revisions
                        set notes = 'mutated'
                        where revision_id = ?
                        """,
                        (submission["revision_id"],),
                    )
                connection.rollback()
                notes = connection.execute(
                    "select notes from local_report_revisions where revision_id = ?",
                    (submission["revision_id"],),
                ).fetchone()[0]

            self.assertIsNone(notes)

    def test_dead_letter_does_not_block_another_ready_report(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalMetricsStore(directory)
            store.append_count_event(_event("entry"), "2026-06-10T00:00:00+00:00")
            store.append_count_event(_event("entry"), "2026-07-10T00:00:00+00:00")
            june = store.record_report_submission("REP-JUNE", JUNE_PERIOD_ID)
            july = store.record_report_submission("REP-JULY", JULY_PERIOD_ID)

            failed = store.record_sync_outbox_failure(
                str(june["outbox_item_id"]),
                error_class="validation_error",
                error_message="Server rejected deterministic input.",
                retryable=False,
                http_status=422,
                failed_at="2026-08-01T00:00:00+00:00",
            )
            ready = store.list_ready_sync_outbox_items(now="2026-08-01T00:00:00+00:00")

            self.assertEqual(failed["status"], "dead_letter")
            self.assertEqual([item["outbox_item_id"] for item in ready], [july["outbox_item_id"]])
            with closing(connect_local_database(_database_path(directory))) as connection:
                attempt = connection.execute(
                    "select * from sync_attempts where outbox_item_id = ?",
                    (june["outbox_item_id"],),
                ).fetchone()
            self.assertEqual(attempt["outcome"], "dead_letter")
            self.assertEqual(attempt["http_status"], 422)

    def test_simulation_derived_report_never_enters_official_ready_queue(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalMetricsStore(directory)
            event = _event("entry")
            event["source_kind"] = "hybrid"
            event["mock_run_id"] = "simulation-1"
            store.append_count_event(event, "2026-06-10T00:00:00+00:00")

            submission = store.record_report_submission(
                "REP-JUNE-SIMULATION",
                JUNE_PERIOD_ID,
                source_kind="hybrid",
                mock_run_id="simulation-1",
            )

            self.assertEqual(store.list_ready_sync_outbox_items(), [])
            with closing(connect_local_database(_database_path(directory))) as connection:
                outbox = connection.execute(
                    "select status, last_error_class from sync_outbox_items "
                    "where outbox_item_id = ?",
                    (submission["outbox_item_id"],),
                ).fetchone()
            self.assertEqual(outbox["status"], "dead_letter")
            self.assertEqual(outbox["last_error_class"], "simulation_not_official")
            self.assertEqual(
                store.sync_outbox_health(),
                {
                    "pending_count": 0,
                    "oldest_pending_at": None,
                    "last_acknowledged_at": None,
                    "last_failure_at": None,
                    "last_failure_class": None,
                },
            )

    def test_retry_backoff_hides_only_the_failed_item_until_ready(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalMetricsStore(directory)
            store.append_count_event(_event("entry"), "2026-06-10T00:00:00+00:00")
            submission = store.record_report_submission("REP-JUNE", JUNE_PERIOD_ID)

            failed = store.record_sync_outbox_failure(
                str(submission["outbox_item_id"]),
                error_class="network_error",
                error_message="Connection reset.",
                retryable=True,
                failed_at="2026-08-01T00:00:00+00:00",
            )

            self.assertEqual(failed["status"], "retry")
            self.assertEqual(failed["attempt_count"], 1)
            self.assertEqual(failed["next_attempt_at"], "2026-08-01T00:00:02+00:00")
            self.assertEqual(
                store.list_ready_sync_outbox_items(now="2026-08-01T00:00:01+00:00"),
                [],
            )
            self.assertEqual(
                len(store.list_ready_sync_outbox_items(now="2026-08-01T00:00:02+00:00")),
                1,
            )

    def test_sync_health_uses_the_complete_durable_outbox_and_attempt_history(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalMetricsStore(directory)
            store.append_count_event(_event("entry"), "2026-06-10T00:00:00+00:00")
            submission = store.record_report_submission("REP-JUNE", JUNE_PERIOD_ID)

            pending = store.sync_outbox_health()

            self.assertEqual(pending["pending_count"], 1)
            self.assertEqual(pending["oldest_pending_at"], submission["submitted_at"])
            self.assertIsNone(pending["last_acknowledged_at"])
            self.assertIsNone(pending["last_failure_at"])
            self.assertIsNone(pending["last_failure_class"])

            store.record_sync_outbox_failure(
                str(submission["outbox_item_id"]),
                error_class="network_error",
                error_message="Connection reset.",
                retryable=True,
                failed_at="2026-08-01T00:00:00+00:00",
            )
            failed = store.sync_outbox_health()

            self.assertEqual(failed["pending_count"], 1)
            self.assertEqual(failed["oldest_pending_at"], submission["submitted_at"])
            self.assertEqual(failed["last_failure_at"], "2026-08-01T00:00:00+00:00")
            self.assertEqual(failed["last_failure_class"], "network_error")

            self.assertTrue(
                store.acknowledge_sync_outbox_item(
                    str(submission["outbox_item_id"]),
                    acknowledged_at="2026-08-01T00:00:03+00:00",
                )
            )
            recovered = LocalMetricsStore(directory).sync_outbox_health()

            self.assertEqual(recovered["pending_count"], 0)
            self.assertIsNone(recovered["oldest_pending_at"])
            self.assertEqual(recovered["last_acknowledged_at"], "2026-08-01T00:00:03+00:00")
            self.assertEqual(recovered["last_failure_at"], "2026-08-01T00:00:00+00:00")
            self.assertEqual(recovered["last_failure_class"], "network_error")

    def test_sync_health_counts_official_dead_letters_even_when_the_ready_page_is_empty(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalMetricsStore(directory)
            store.append_count_event(_event("entry"), "2026-06-10T00:00:00+00:00")
            submission = store.record_report_submission("REP-JUNE", JUNE_PERIOD_ID)
            store.record_sync_outbox_failure(
                str(submission["outbox_item_id"]),
                error_class="validation_error",
                error_message="Server rejected deterministic input.",
                retryable=False,
                http_status=422,
                failed_at="2026-08-01T00:00:00+00:00",
            )

            self.assertEqual(store.list_ready_sync_outbox_items(), [])
            self.assertEqual(
                store.sync_outbox_health(),
                {
                    "pending_count": 1,
                    "oldest_pending_at": submission["submitted_at"],
                    "last_acknowledged_at": None,
                    "last_failure_at": "2026-08-01T00:00:00+00:00",
                    "last_failure_class": "validation_error",
                },
            )


def _database_path(directory: str) -> Path:
    return Path(directory) / "ml-service" / "tanaw_metrics.sqlite3"


def submission_payload(row: sqlite3.Row) -> dict[str, Any]:
    value = json.loads(str(row["payload_json"]))
    assert isinstance(value, dict)
    return value


def _event(
    direction: str,
    *,
    camera_id: int = 1,
    camera_name: str = "Main",
) -> dict[str, Any]:
    return {
        "camera_id": camera_id,
        "central_camera_id": (
            "11111111-1111-4111-8111-111111111111"
            if camera_id == 1
            else "22222222-2222-4222-8222-222222222222"
        ),
        "camera_name": camera_name,
        "direction": direction,
        "track_id": 1,
        "counts": {"entry": 1, "exit": 0, "occupancy": 1},
    }


if __name__ == "__main__":
    unittest.main()
