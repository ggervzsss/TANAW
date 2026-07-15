import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path

from app.config.camera_config import reporting_period_submission_error
from app.storage.local_ledger import LocalLedger
from app.storage.reporting_periods import monthly_period_for_captured_at

CURRENT_PERIOD_ID = monthly_period_for_captured_at(datetime.now(UTC)).period_id
JUNE_PERIOD_ID = "month:Asia/Manila:2026-06"
JULY_PERIOD_ID = "month:Asia/Manila:2026-07"


class LocalLedgerTest(unittest.TestCase):
    def test_reporting_period_submission_opens_after_reporting_month_closes(self) -> None:
        self.assertIsNotNone(
            reporting_period_submission_error(
                JULY_PERIOD_ID, datetime(2026, 7, 31, 15, 59, tzinfo=UTC)
            )
        )
        self.assertIsNone(
            reporting_period_submission_error(
                JULY_PERIOD_ID, datetime(2026, 7, 31, 16, 0, tzinfo=UTC)
            )
        )

    def test_duplicate_reporting_period_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)))
            store.append_count_event(_event("entry", entry=1, exit=0, occupancy=1))
            store.create_local_report_revision(
                "REP-001", JUNE_PERIOD_ID, payload={"source": "test"}
            )

            with self.assertRaisesRegex(ValueError, "Jun 1 - Jun 30, 2026"):
                store.create_local_report_revision(
                    "REP-002", JUNE_PERIOD_ID, payload={"source": "test"}
                )

    def test_count_events_are_summarized_and_marked_submitted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)))
            store.append_count_event(_event("entry", entry=1, exit=0, occupancy=1))
            store.append_count_event(_event("exit", entry=1, exit=1, occupancy=0))

            summary = store.metrics_summary()
            self.assertEqual(summary["entries"], 1)
            self.assertEqual(summary["exits"], 1)
            self.assertEqual(summary["peak_occupancy"], 1)
            self.assertEqual(summary["unique_count"], 1)
            self.assertEqual(summary["unsubmitted_events"], 2)

            submission = store.create_local_report_revision(
                "REP-001", CURRENT_PERIOD_ID, "notes", {"source": "test"}
            )
            self.assertEqual(submission["report_id"], "REP-001")
            self.assertEqual(submission["sync_status"], "pending_cloud_sync")
            self.assertEqual(store.metrics_summary()["unsubmitted_events"], 0)
            self.assertEqual(store.metrics_summary()["entries"], 0)
            self.assertEqual(store.metrics_summary(include_submitted=True)["entries"], 1)

    def test_event_attributes_reject_nonfinite_or_oversized_documents(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)))
            nonfinite = _event("entry", entry=1, exit=0, occupancy=1)
            nonfinite["reid_score"] = float("nan")
            oversized = _event("entry", entry=1, exit=0, occupancy=1)
            oversized["debug"] = "x" * 65_536

            with self.assertRaisesRegex(ValueError, "finite JSON"):
                store.append_count_event(nonfinite)
            with self.assertRaisesRegex(ValueError, "exceed 65536 bytes"):
                store.append_count_event(oversized)

            self.assertEqual(store.metrics_summary(include_submitted=True)["total_events"], 0)

    def test_local_reports_are_listed_with_payload(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)))
            store.append_count_event(_event("entry", entry=1, exit=0, occupancy=1))

            store.create_local_report_revision(
                "REP-001", CURRENT_PERIOD_ID, "notes", {"demo": {"foreignMale": "2"}}
            )

            reports = store.list_local_reports()
            self.assertEqual(len(reports), 1)
            self.assertEqual(reports[0]["report_id"], "REP-001")
            self.assertEqual(reports[0]["entries"], 1)
            self.assertEqual(reports[0]["notes"], "notes")
            self.assertEqual(reports[0]["payload"]["demo"]["foreignMale"], "2")

    def test_purging_report_raw_events_keeps_submission_summary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)))
            store.append_count_event(_event("entry", entry=1, exit=0, occupancy=1))
            store.append_count_event(_event("exit", entry=1, exit=1, occupancy=0))
            revision = store.create_local_report_revision(
                "REP-001", CURRENT_PERIOD_ID, "notes", {"source": "test"}
            )
            store.acknowledge_sync_outbox_item(str(revision["outbox_item_id"]))

            purged = store.purge_report_raw_events("REP-001", str(revision["revision_id"]))

            self.assertEqual(purged["report_id"], "REP-001")
            self.assertEqual(purged["purged_events"], 2)
            self.assertIsNotNone(purged["raw_purged_at"])
            self.assertEqual(store.metrics_summary(include_submitted=True)["entries"], 1)
            reports = store.list_local_reports()
            self.assertEqual(len(reports), 1)
            self.assertEqual(reports[0]["entries"], 1)
            self.assertEqual(reports[0]["unique_count"], 1)
            self.assertEqual(reports[0]["raw_purged_at"], purged["raw_purged_at"])

            repeated = store.purge_report_raw_events("REP-001", str(revision["revision_id"]))
            self.assertEqual(repeated["purged_events"], 0)
            self.assertEqual(repeated["raw_purged_at"], purged["raw_purged_at"])

    def test_hybrid_mock_rows_are_tagged_and_removed_without_real_rows(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)))
            store.append_count_event(_event("entry", entry=1, exit=0, occupancy=1))
            hybrid_event = _event("entry", entry=2, exit=0, occupancy=2)
            hybrid_event["source_kind"] = "hybrid"
            hybrid_event["mock_run_id"] = "mock-run-1"
            store.append_count_event(hybrid_event)
            store.create_local_report_revision(
                "REP-260601",
                CURRENT_PERIOD_ID,
                "Monthly visitor count submitted for LGU review.",
                {"source": "hybrid"},
                source_kind="hybrid",
                mock_run_id="mock-run-1",
            )

            reports = store.list_local_reports()
            self.assertEqual(reports[0]["source_kind"], "hybrid")
            self.assertEqual(reports[0]["mock_run_id"], "mock-run-1")

            removed = store.remove_mock_data("mock-run-1")

            self.assertEqual(removed["count_events"], 1)
            self.assertEqual(removed["local_reports"], 1)
            self.assertEqual(store.metrics_summary(include_submitted=True)["entries"], 1)

    def test_removing_hybrid_report_restores_real_camera_events_to_current_draft(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)))
            mock_event = _event("entry", entry=1, exit=0, occupancy=1)
            mock_event["source_kind"] = "mock"
            mock_event["mock_run_id"] = "mock-run-1"
            store.append_count_event(mock_event)
            store.append_count_event(_event("entry", entry=2, exit=0, occupancy=2))

            submission = store.create_local_report_revision("REP-260601", CURRENT_PERIOD_ID)
            self.assertEqual(submission["source_kind"], "hybrid")
            self.assertEqual(submission["mock_run_id"], "mock-run-1")
            self.assertEqual(store.metrics_summary()["unsubmitted_events"], 0)

            removed = store.remove_mock_data("mock-run-1")

            self.assertEqual(removed["count_events"], 1)
            self.assertEqual(removed["local_reports"], 1)
            self.assertEqual(removed["restored_real_events"], 1)
            self.assertEqual(store.list_local_reports(), [])
            self.assertEqual(store.metrics_summary()["entries"], 1)
            self.assertEqual(store.metrics_summary()["unsubmitted_events"], 1)

    def test_resubmitting_existing_report_preserves_metrics_when_no_new_events_exist(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)))
            store.append_count_event(_event("entry", entry=1, exit=0, occupancy=1))
            store.create_local_report_revision(
                "REP-001", CURRENT_PERIOD_ID, "first", {"notes": "first"}
            )

            resubmission = store.create_local_report_revision(
                "REP-001", CURRENT_PERIOD_ID, "revised", {"notes": "revised"}
            )

            self.assertEqual(resubmission["entries"], 1)
            self.assertEqual(resubmission["unique_count"], 1)
            reports = store.list_local_reports()
            self.assertEqual(reports[0]["entries"], 1)
            self.assertEqual(reports[0]["unique_count"], 1)
            self.assertEqual(reports[0]["notes"], "revised")

    def test_resubmitting_existing_report_uses_report_metrics_not_current_counts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)))
            store.append_count_event(
                _event("entry", entry=1, exit=0, occupancy=1),
                "2026-06-15T04:00:00+00:00",
            )
            store.create_local_report_revision(
                "REP-001", JUNE_PERIOD_ID, "first", {"notes": "first"}
            )
            store.append_count_event(
                _event("entry", entry=2, exit=0, occupancy=2),
                "2026-07-15T04:00:00+00:00",
            )

            resubmission = store.create_local_report_revision(
                "REP-001",
                JUNE_PERIOD_ID,
                "revised",
                {"notes": "revised"},
                metrics={
                    "entries": 1,
                    "exits": 0,
                    "peak_occupancy": 1,
                    "unique_count": 1,
                },
            )

            self.assertEqual(resubmission["entries"], 1)
            self.assertEqual(resubmission["unique_count"], 1)
            self.assertEqual(store.metrics_summary()["entries"], 1)
            self.assertEqual(store.metrics_summary()["unsubmitted_events"], 1)
            reports = store.list_local_reports()
            self.assertEqual(reports[0]["entries"], 1)
            self.assertEqual(reports[0]["unique_count"], 1)
            self.assertEqual(reports[0]["notes"], "revised")

    def test_resubmitting_cloud_report_does_not_consume_current_open_events(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)))
            store.append_count_event(_event("entry", entry=1, exit=0, occupancy=1))

            resubmission = store.create_local_report_revision(
                "REP-CLOUD",
                JUNE_PERIOD_ID,
                "revised",
                {"status": "Resubmitted"},
                metrics={
                    "entries": 5,
                    "exits": 2,
                    "peak_occupancy": 4,
                    "unique_count": 3,
                },
            )

            self.assertEqual(resubmission["entries"], 5)
            self.assertEqual(resubmission["unique_count"], 3)
            self.assertEqual(store.metrics_summary()["entries"], 1)
            self.assertEqual(store.metrics_summary()["unsubmitted_events"], 1)

    def test_metrics_history_groups_events_and_can_include_submitted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)))
            store.append_count_event(
                _event("entry", entry=1, exit=0, occupancy=1, is_unique_entry=True),
                "2026-06-11T00:15:00+00:00",
            )
            store.append_count_event(
                _event("entry", entry=2, exit=0, occupancy=2, is_unique_entry=False),
                "2026-06-11T00:45:00+00:00",
            )
            store.append_count_event(
                _event("exit", entry=2, exit=1, occupancy=1), "2026-06-11T02:10:00+00:00"
            )
            store.create_local_report_revision("REP-001", JUNE_PERIOD_ID)

            empty_history = store.metrics_history(now=datetime(2026, 6, 11, 3, 0, tzinfo=UTC))
            self.assertEqual(sum(point["entry"] for point in empty_history["hourly_density"]), 0)

            history = store.metrics_history(
                include_submitted=True, now=datetime(2026, 6, 11, 3, 0, tzinfo=UTC)
            )
            midnight_bucket = history["hourly_density"][0]
            two_am_bucket = history["hourly_density"][2]

            self.assertEqual(midnight_bucket["entry"], 2)
            self.assertEqual(midnight_bucket["unique"], 1)
            self.assertEqual(midnight_bucket["occupancy"], 2)
            self.assertEqual(two_am_bucket["exit"], 1)
            self.assertEqual(history["historical"]["Today"][0]["visitors"], 1)
            self.assertEqual(history["historical"]["Week"][-1]["entries"], 2)

    def test_unique_count_uses_identity_decision_fields(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)))
            store.append_count_event(
                _event("entry", entry=1, exit=0, occupancy=1, is_unique_entry=True)
            )
            store.append_count_event(_event("exit", entry=1, exit=1, occupancy=0))
            store.append_count_event(
                _event("entry", entry=2, exit=1, occupancy=1, is_unique_entry=False)
            )

            summary = store.metrics_summary()

            self.assertEqual(summary["entries"], 2)
            self.assertEqual(summary["exits"], 1)
            self.assertEqual(summary["unique_count"], 1)
            self.assertEqual(summary["confirmed_unique_count"], 0)
            self.assertEqual(summary["degraded_unique_count"], 1)

    def test_confirmed_and_degraded_unique_counts_are_separated(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)))
            confirmed = _event("entry", entry=1, exit=0, occupancy=1, is_unique_entry=True)
            confirmed["visitor_id"] = "visitor-1"
            confirmed["reid_decision"] = "new"
            degraded = _event("entry", entry=2, exit=0, occupancy=2, is_unique_entry=True)
            degraded["reid_decision"] = "degraded_no_embedding"
            store.append_count_event(confirmed)
            store.append_count_event(degraded)

            summary = store.metrics_summary()

            self.assertEqual(summary["unique_count"], 2)
            self.assertEqual(summary["estimated_unique_count"], 2)
            self.assertEqual(summary["confirmed_unique_count"], 1)
            self.assertEqual(summary["degraded_unique_count"], 1)
            self.assertEqual(summary["repeat_entry_count"], 0)

    def test_occupancy_corrections_are_audited_and_included_in_summary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)), "enterprise-a")
            store.append_count_event(_event("entry", entry=1, exit=0, occupancy=1))
            store.append_count_event(_event("exit", entry=1, exit=1, occupancy=0))

            correction = store.record_occupancy_correction(
                enterprise_id="enterprise-a",
                camera_id=1,
                old_occupancy=0,
                new_occupancy=3,
                reason="Manual headcount at front desk",
                actor_name="Manager",
            )
            summary = store.metrics_summary()
            corrections = store.list_occupancy_corrections()

            self.assertEqual(correction["delta"], 3)
            self.assertEqual(summary["current_occupancy"], 3)
            self.assertEqual(summary["occupancy_correction_delta"], 3)
            self.assertEqual(summary["peak_occupancy"], 3)
            self.assertEqual(len(corrections), 1)
            self.assertEqual(corrections[0]["reason"], "Manual headcount at front desk")

    def test_expired_visitor_metadata_cleanup_preserves_count_events(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)))
            store.upsert_visitor_identity(
                visitor_id="visitor-1",
                business_date="2026-06-07",
                camera_id=1,
                embedding=b"\x00" * 8,
                embedding_dim=2,
                embedding_count=1,
                model_name="test",
                expires_at="2026-06-07T02:00:00+00:00",
                recorded_at="2026-06-07T01:00:00+00:00",
            )
            store.append_visitor_sighting(
                {
                    "visitor_id": "visitor-1",
                    "business_date": "2026-06-07",
                    "camera_id": 1,
                    "track_id": 99,
                    "direction": "entry",
                    "reid_decision": "new",
                    "identity_confidence": "high",
                },
                "2026-06-07T01:05:00+00:00",
            )
            store.append_count_event(
                _event("entry", entry=1, exit=0, occupancy=1, is_unique_entry=True)
            )

            deleted_count = store.cleanup_expired_visitor_metadata("2026-06-07T03:00:00+00:00")

            self.assertEqual(deleted_count, 1)
            self.assertEqual(
                store.load_active_visitor_identities("2026-06-07", "2026-06-07T03:00:00+00:00"), []
            )
            self.assertEqual(store.metrics_summary()["total_events"], 1)

    def test_secondary_model_embedding_is_persisted_with_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)))
            store.upsert_visitor_identity(
                visitor_id="visitor-1",
                business_date="2026-06-07",
                camera_id=1,
                embedding=b"\x00" * 8,
                embedding_dim=2,
                embedding_count=1,
                model_name="fast",
                expires_at="2026-06-08T02:00:00+00:00",
                recorded_at="2026-06-07T01:00:00+00:00",
            )
            store.upsert_visitor_model_embedding(
                visitor_id="visitor-1",
                model_name="quality",
                embedding=b"\x01" * 8,
                embedding_dim=2,
                embedding_count=1,
                recorded_at="2026-06-07T01:01:00+00:00",
            )

            rows = store.load_active_visitor_model_embeddings(
                "2026-06-07",
                "quality",
                "2026-06-07T03:00:00+00:00",
            )

            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["visitor_id"], "visitor-1")
            self.assertEqual(rows[0]["model_name"], "quality")

    def test_enterprise_scopes_use_separate_ledgers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            first = LocalLedger(str(Path(directory)), "enterprise-a@tanaw.test")
            second = LocalLedger(str(Path(directory)), "enterprise-b@tanaw.test")
            first.append_count_event(_event("entry", entry=1, exit=0, occupancy=1))

            self.assertEqual(first.metrics_summary()["entries"], 1)
            self.assertEqual(second.metrics_summary()["entries"], 0)

    def test_prepared_counts_are_finite_and_report_ready(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)), "target@tanaw.test")

            summary = store.prepare_mock_counts(
                mock_run_id="run-1",
                entries=40,
                exits=31,
                unique_count=24,
                peak_occupancy=12,
                camera_id=7,
                camera_name="Main Entrance",
                period_id=JUNE_PERIOD_ID,
            )

            self.assertEqual(summary["entries"], 40)
            self.assertEqual(summary["exits"], 31)
            self.assertEqual(summary["unique_count"], 24)
            self.assertEqual(summary["unsubmitted_events"], 71)
            self.assertEqual(summary["source_kind"], "mock")
            self.assertEqual(summary["mock_run_id"], "run-1")
            self.assertEqual(summary["period"], "Jun 1 - Jun 30, 2026")
            self.assertTrue(summary["prepared"])
            self.assertEqual(store.list_local_reports(), [])

            repeated = store.prepare_mock_counts(
                mock_run_id="run-1",
                entries=40,
                exits=31,
                unique_count=24,
                peak_occupancy=12,
                camera_id=7,
                camera_name="Main Entrance",
                period_id=JUNE_PERIOD_ID,
            )
            self.assertFalse(repeated["prepared"])
            self.assertEqual(repeated["total_events"], 71)

    def test_prepared_counts_allow_next_period_after_submission(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)), "target@tanaw.test")

            first = store.prepare_mock_counts(
                mock_run_id="run-1",
                entries=40,
                exits=31,
                unique_count=24,
                peak_occupancy=12,
                camera_id=7,
                camera_name="Main Entrance",
                period_id=JUNE_PERIOD_ID,
            )
            self.assertTrue(first["prepared"])

            store.create_local_report_revision("REP-JUN", JUNE_PERIOD_ID)

            second = store.prepare_mock_counts(
                mock_run_id="run-1",
                entries=55,
                exits=42,
                unique_count=36,
                peak_occupancy=18,
                camera_id=7,
                camera_name="Main Entrance",
                period_id=JULY_PERIOD_ID,
            )

            self.assertTrue(second["prepared"])
            self.assertEqual(second["entries"], 55)
            self.assertEqual(second["period"], "Jul 1 - Jul 31, 2026")
            self.assertEqual(len(store.list_local_reports()), 1)

    def test_prepared_counts_can_switch_open_periods(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)), "target@tanaw.test")

            first = store.prepare_mock_counts(
                mock_run_id="run-1",
                entries=40,
                exits=31,
                unique_count=24,
                peak_occupancy=12,
                camera_id=7,
                camera_name="Main Entrance",
                period_id=JUNE_PERIOD_ID,
            )
            self.assertTrue(first["prepared"])

            second = store.prepare_mock_counts(
                mock_run_id="run-1",
                entries=55,
                exits=42,
                unique_count=36,
                peak_occupancy=18,
                camera_id=7,
                camera_name="Main Entrance",
                period_id=JULY_PERIOD_ID,
            )

            self.assertTrue(second["prepared"])
            self.assertEqual(second["entries"], 55)
            self.assertEqual(second["period"], "Jul 1 - Jul 31, 2026")
            self.assertEqual(store.metrics_summary()["period"], "Jul 1 - Jul 31, 2026")

    def test_sync_acknowledgements_update_local_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)), "target@tanaw.test")
            store.append_count_event(_event("entry", entry=1, exit=0, occupancy=1))
            submission = store.create_local_report_revision("REP-001", CURRENT_PERIOD_ID)

            self.assertEqual(store.metrics_summary(include_submitted=True)["unsynced_events"], 1)
            self.assertTrue(store.acknowledge_sync_outbox_item(str(submission["outbox_item_id"])))

            report = store.list_local_reports()[0]
            self.assertEqual(report["sync_status"], "synced")
            self.assertIsNotNone(report["synced_at"])
            self.assertEqual(store.metrics_summary(include_submitted=True)["unsynced_events"], 0)

    def test_mixed_real_and_prepared_counts_preserve_run_provenance(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(str(Path(directory)), "target@tanaw.test")
            store.prepare_mock_counts(
                mock_run_id="run-1",
                entries=4,
                exits=2,
                unique_count=3,
                peak_occupancy=3,
                camera_id=1,
                camera_name="Main Entrance",
                period_id=CURRENT_PERIOD_ID,
            )
            store.append_count_event(_event("entry", entry=5, exit=2, occupancy=3))

            summary = store.metrics_summary()
            self.assertEqual(summary["source_kind"], "hybrid")
            self.assertEqual(summary["mock_run_id"], "run-1")

            submission = store.create_local_report_revision("REP-002", CURRENT_PERIOD_ID)
            report = store.list_local_reports()[0]
            self.assertEqual(submission["source_kind"], "hybrid")
            self.assertEqual(submission["mock_run_id"], "run-1")
            self.assertEqual(report["source_kind"], "hybrid")
            self.assertEqual(report["mock_run_id"], "run-1")


def _event(
    direction: str, entry: int, exit: int, occupancy: int, is_unique_entry: bool | None = None
) -> dict:
    payload = {
        "camera_id": 1,
        "central_camera_id": "11111111-1111-4111-8111-111111111111",
        "camera_name": "Test Camera",
        "counts": {
            "entry": entry,
            "exit": exit,
            "occupancy": occupancy,
        },
        "direction": direction,
        "track_id": 99,
    }
    if is_unique_entry is not None:
        payload["is_unique_entry"] = is_unique_entry
    return {
        **payload,
    }


if __name__ == "__main__":
    unittest.main()
