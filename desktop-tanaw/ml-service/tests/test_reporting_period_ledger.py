import sqlite3
import tempfile
import threading
import unittest
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch

from pydantic import ValidationError

from app.config.camera_config import LocalReportRevisionRequest, MockPrepareRequest
from app.storage.local_ledger import LocalLedger
from app.storage.local_schema import (
    LOCAL_SCHEMA_VERSION,
    SQLITE_BUSY_TIMEOUT_MS,
    connect_local_database,
    initialize_local_database,
)
from app.storage.reporting_periods import (
    monthly_period,
    monthly_period_for_captured_at,
    monthly_period_from_label,
)

JUNE_PERIOD_ID = "month:Asia/Manila:2026-06"
JULY_PERIOD_ID = "month:Asia/Manila:2026-07"


class ReportingPeriodTest(unittest.TestCase):
    def test_manila_month_boundary_uses_a_half_open_window(self) -> None:
        last_june_instant = datetime(2026, 6, 30, 15, 59, 59, 999999, tzinfo=UTC)
        first_july_instant = datetime(2026, 6, 30, 16, 0, 0, tzinfo=UTC)

        june = monthly_period_for_captured_at(last_june_instant)
        july = monthly_period_for_captured_at(first_july_instant)

        self.assertEqual(june.period_id, JUNE_PERIOD_ID)
        self.assertEqual(july.period_id, JULY_PERIOD_ID)
        self.assertTrue(june.contains(last_june_instant))
        self.assertFalse(june.contains(first_july_instant))
        self.assertEqual(june.ends_at_utc, first_july_instant)

    def test_only_complete_calendar_month_labels_are_canonicalized(self) -> None:
        self.assertEqual(
            monthly_period_from_label("June 2026"),
            monthly_period(2026, 6),
        )
        self.assertEqual(
            monthly_period_from_label("Jun 1 - Jun 30, 2026"),
            monthly_period(2026, 6),
        )
        self.assertIsNone(monthly_period_from_label("Jun 2 - Jun 30, 2026"))
        self.assertIsNone(monthly_period_from_label("Jun 1 - Jul 31, 2026"))
        self.assertIsNone(monthly_period_from_label("Current Period"))

    def test_report_submission_contract_requires_canonical_identity_and_exact_bounds(self) -> None:
        valid_payload = {
            "report_id": "REP-JUNE",
            "period_id": JUNE_PERIOD_ID,
            "source_window": {
                "start": "2026-05-31T16:00:00Z",
                "end": "2026-06-30T16:00:00Z",
            },
            "payload": {
                "demo": {
                    "thisProvMale": "1",
                    "thisProvFemale": "0",
                    "otherProvMale": "0",
                    "otherProvFemale": "0",
                    "foreignMale": "0",
                    "foreignFemale": "0",
                }
            },
        }

        request = LocalReportRevisionRequest.model_validate(valid_payload)

        self.assertEqual(request.period_id, JUNE_PERIOD_ID)
        for invalid_payload in (
            {**valid_payload, "period_id": "Jun 1 - Jun 30, 2026"},
            {
                **valid_payload,
                "source_window": {
                    "start": "2026-05-31T16:00:00Z",
                    "end": "2026-07-31T16:00:00Z",
                },
            },
        ):
            with self.subTest(payload=invalid_payload), self.assertRaises(ValidationError):
                LocalReportRevisionRequest.model_validate(invalid_payload)
        missing_period = dict(valid_payload)
        del missing_period["period_id"]
        with self.assertRaises(ValidationError):
            LocalReportRevisionRequest.model_validate(missing_period)

    def test_report_submission_allows_zero_or_partial_demographic_facts(self) -> None:
        no_facts = _report_submission_request_payload(payload={})
        partial_facts = _report_submission_request_payload(
            payload={
                "demo": {"thisProvMale": "30", "foreignFemale": ""},
                "demographicFacts": [
                    {
                        "dimension": "residence_sex",
                        "value": "this_province_male",
                        "count": 30,
                        "provenance": "operator_entered",
                        "quality": "confirmed",
                    }
                ],
            },
            unique_count=1,
        )

        self.assertEqual(
            LocalReportRevisionRequest.model_validate(no_facts).payload,
            {},
        )
        request = LocalReportRevisionRequest.model_validate(partial_facts)
        self.assertEqual(request.metrics.unique_count if request.metrics else None, 1)
        self.assertEqual(
            request.payload["demographicFacts"] if request.payload else None,
            partial_facts["payload"]["demographicFacts"],
        )

    def test_report_submission_rejects_malformed_negative_or_duplicate_demographic_facts(
        self,
    ) -> None:
        valid_fact = {
            "dimension": "residence_sex",
            "value": "this_province_male",
            "count": 3,
            "provenance": "operator_entered",
            "quality": "confirmed",
        }
        invalid_payloads = (
            {"demo": {"thisProvMale": "-1"}},
            {"demographicFacts": [{**valid_fact, "count": -1}]},
            {"demo": {"thisProvMale": "2147483648"}},
            {"demographicFacts": [{**valid_fact, "count": 2_147_483_648}]},
            {"demographicFacts": [{**valid_fact, "quality": None}]},
            {"demographicFacts": [valid_fact, dict(valid_fact)]},
        )

        for report_payload in invalid_payloads:
            with self.subTest(payload=report_payload), self.assertRaises(ValidationError):
                LocalReportRevisionRequest.model_validate(
                    _report_submission_request_payload(payload=report_payload)
                )

    def test_mock_preparation_contract_requires_explicit_selected_period(self) -> None:
        payload = {
            "mock_run_id": "run-1",
            "enterprise_id": "enterprise-1",
            "entries": 4,
            "exits": 2,
            "unique_count": 3,
            "peak_occupancy": 3,
            "period_id": JULY_PERIOD_ID,
            "source_window": {
                "start": "2026-06-30T16:00:00Z",
                "end": "2026-07-31T16:00:00Z",
            },
        }

        self.assertEqual(
            MockPrepareRequest.model_validate(payload).period_id,
            JULY_PERIOD_ID,
        )
        with self.assertRaises(ValidationError):
            MockPrepareRequest.model_validate({**payload, "period_id": "Current Period"})


class LocalReportingLedgerTest(unittest.TestCase):
    def test_count_events_store_business_date_and_canonical_period(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(directory)
            store.append_count_event(
                _event("entry"),
                "2026-06-30T15:59:59.999999+00:00",
            )
            store.append_count_event(
                _event("entry"),
                "2026-06-30T16:00:00+00:00",
            )

            database_path = Path(directory) / "ml-service" / "tanaw_metrics.sqlite3"
            with closing(connect_local_database(database_path)) as connection:
                rows = connection.execute(
                    """
                    select business_date, reporting_period_id
                    from count_events
                    order by recorded_at
                    """
                ).fetchall()

            self.assertEqual(
                [tuple(row) for row in rows],
                [
                    ("2026-06-30", JUNE_PERIOD_ID),
                    ("2026-07-01", JULY_PERIOD_ID),
                ],
            )

    def test_june_report_never_summarizes_or_consumes_july_event(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(directory)
            store.append_count_event(
                _event("entry"),
                "2026-06-30T15:59:59.999999+00:00",
            )
            store.append_count_event(
                _event("entry"),
                "2026-06-30T16:00:00+00:00",
            )

            self.assertEqual(store.metrics_summary(period_id=JUNE_PERIOD_ID)["entries"], 1)
            self.assertEqual(store.metrics_summary(period_id=JULY_PERIOD_ID)["entries"], 1)

            submission = store.create_local_report_revision("REP-JUNE", JUNE_PERIOD_ID)

            self.assertEqual(submission["period_id"], JUNE_PERIOD_ID)
            self.assertEqual(submission["entries"], 1)
            self.assertEqual(store.metrics_summary(period_id=JUNE_PERIOD_ID)["entries"], 0)
            self.assertEqual(store.metrics_summary(period_id=JULY_PERIOD_ID)["entries"], 1)

    def test_display_label_is_rejected_even_when_open_events_span_months(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(directory)
            store.append_count_event(_event("entry"), "2026-06-15T00:00:00+00:00")
            store.append_count_event(_event("entry"), "2026-07-15T00:00:00+00:00")

            with self.assertRaisesRegex(ValueError, "month:Asia/Manila:YYYY-MM"):
                store.create_local_report_revision("REP-AMBIGUOUS", "Current Period")

    def test_correction_only_store_remains_unclassified(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(directory)
            store.record_occupancy_correction(
                enterprise_id=None,
                camera_id=None,
                old_occupancy=0,
                new_occupancy=3,
                reason="Manual reconciliation without classified capture evidence",
                recorded_at="2026-06-15T00:00:00+00:00",
            )

            summary = store.metrics_summary()

            self.assertIsNone(summary["period_id"])
            self.assertIsNone(summary["starts_at_utc"])
            self.assertEqual(summary["entries"], 0)
            with self.assertRaisesRegex(ValueError, "month:Asia/Manila:YYYY-MM"):
                store.create_local_report_revision("REP-UNCLASSIFIED", "")

    def test_target_schema_is_created_idempotently_without_superseded_objects(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "ml-service" / "tanaw_metrics.sqlite3"

            initialize_local_database(database_path)
            initialize_local_database(database_path)

            with closing(connect_local_database(database_path)) as connection:
                tables = {
                    row["name"]
                    for row in connection.execute(
                        "select name from sqlite_master where type = 'table'"
                    )
                }
                event_columns = {
                    row["name"] for row in connection.execute("pragma table_info(count_events)")
                }
                user_version = connection.execute("pragma user_version").fetchone()[0]
                foreign_key_failures = connection.execute("pragma foreign_key_check").fetchall()

            self.assertEqual(user_version, LOCAL_SCHEMA_VERSION)
            self.assertEqual(foreign_key_failures, [])
            self.assertTrue(
                {"count_snapshots", "report_submissions", "local_schema_migrations"}.isdisjoint(
                    tables
                )
            )
            self.assertTrue(
                {"payload_json", "submitted_report_id", "synced_at"}.isdisjoint(event_columns)
            )

    def test_target_runtime_rejects_every_unregistered_schema_object(self) -> None:
        statements = (
            "create table backup_count_events (id text primary key)",
            "create view shadow_counts as select event_id from count_events",
            "create index comparison_count_events on count_events(recorded_at, event_id)",
            "create trigger checkpoint_count_events after insert on count_events begin select 1; end",
        )
        for statement in statements:
            with self.subTest(statement=statement), tempfile.TemporaryDirectory() as directory:
                database_path = Path(directory) / "ledger.sqlite3"
                initialize_local_database(database_path)
                with closing(connect_local_database(database_path)) as connection:
                    connection.execute(statement)
                    connection.commit()

                with self.assertRaisesRegex(RuntimeError, "not the exact target schema"):
                    initialize_local_database(database_path)

    def test_target_runtime_rejects_a_changed_table_definition(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "ledger.sqlite3"
            initialize_local_database(database_path)
            with closing(connect_local_database(database_path)) as connection:
                connection.execute("alter table count_events add column backup_payload text")
                connection.commit()

            with self.assertRaisesRegex(RuntimeError, "not the exact target schema"):
                initialize_local_database(database_path)

    def test_pre_cutover_store_is_rejected_without_runtime_migration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "ledger.sqlite3"
            with closing(sqlite3.connect(database_path)) as connection:
                connection.execute("create table report_submissions (report_id text primary key)")
                connection.execute("pragma user_version = 5")
                connection.commit()

            with self.assertRaisesRegex(RuntimeError, "coordinated pre-cutover migration"):
                initialize_local_database(database_path)

            with closing(sqlite3.connect(database_path)) as connection:
                self.assertIsNotNone(
                    connection.execute(
                        "select 1 from sqlite_master where name = 'report_submissions'"
                    ).fetchone()
                )
                self.assertEqual(connection.execute("pragma user_version").fetchone()[0], 5)

    def test_interrupted_target_schema_creation_rolls_back_cleanly(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "ledger.sqlite3"

            with patch(
                "app.storage.local_schema.create_target_schema",
                side_effect=RuntimeError("simulated target initialization interruption"),
            ):
                with self.assertRaisesRegex(RuntimeError, "simulated target initialization"):
                    initialize_local_database(database_path)

            with closing(sqlite3.connect(database_path)) as connection:
                tables = connection.execute(
                    "select name from sqlite_master where type = 'table'"
                ).fetchall()
                self.assertEqual(tables, [])
                self.assertEqual(connection.execute("pragma user_version").fetchone()[0], 0)

    def test_report_transaction_leaves_concurrent_same_period_insert_open(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            bootstrap = LocalLedger(directory)
            bootstrap.append_count_event(_event("entry"), "2026-06-15T00:00:00+00:00")
            writer = LocalLedger(directory)
            writer.metrics_summary(period_id=JUNE_PERIOD_ID)
            report_store = _BlockingReportStore(directory)

            report_result: dict[str, Any] = {}
            errors: list[BaseException] = []

            def submit_report() -> None:
                try:
                    report_result.update(
                        report_store.create_local_report_revision("REP-JUNE", JUNE_PERIOD_ID)
                    )
                except BaseException as exc:  # pragma: no cover - assertion captures thread errors
                    errors.append(exc)

            def append_during_report() -> None:
                try:
                    writer.append_count_event(
                        _event("entry"),
                        "2026-06-20T00:00:00+00:00",
                    )
                except BaseException as exc:  # pragma: no cover - assertion captures thread errors
                    errors.append(exc)

            report_thread = threading.Thread(target=submit_report)
            report_thread.start()
            self.assertTrue(report_store.transaction_entered.wait(timeout=2))

            insert_thread = threading.Thread(target=append_during_report)
            insert_thread.start()
            report_store.release_transaction.set()
            report_thread.join(timeout=5)
            insert_thread.join(timeout=5)

            self.assertFalse(report_thread.is_alive())
            self.assertFalse(insert_thread.is_alive())
            self.assertEqual(errors, [])
            self.assertEqual(report_result["entries"], 1)
            self.assertEqual(writer.metrics_summary(period_id=JUNE_PERIOD_ID)["entries"], 1)
            self.assertEqual(
                writer.metrics_summary(
                    include_submitted=True,
                    period_id=JUNE_PERIOD_ID,
                )["entries"],
                2,
            )

    def test_local_connections_enable_wal_foreign_keys_and_busy_timeout(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = LocalLedger(directory)
            store.metrics_summary()
            database_path = Path(directory) / "ml-service" / "tanaw_metrics.sqlite3"

            with closing(connect_local_database(database_path)) as connection:
                journal_mode = connection.execute("pragma journal_mode").fetchone()[0]
                foreign_keys = connection.execute("pragma foreign_keys").fetchone()[0]
                busy_timeout = connection.execute("pragma busy_timeout").fetchone()[0]

            self.assertEqual(str(journal_mode).lower(), "wal")
            self.assertEqual(foreign_keys, 1)
            self.assertEqual(busy_timeout, SQLITE_BUSY_TIMEOUT_MS)


class _BlockingReportStore(LocalLedger):
    def __init__(self, app_data_dir: str) -> None:
        super().__init__(app_data_dir)
        self.transaction_entered = threading.Event()
        self.release_transaction = threading.Event()

    def _metrics_summary(
        self,
        connection: sqlite3.Connection,
        *,
        include_submitted: bool,
        period_id: str | None,
    ) -> dict[str, int | str | None]:
        if connection.in_transaction and not self.transaction_entered.is_set():
            self.transaction_entered.set()
            if not self.release_transaction.wait(timeout=5):
                raise TimeoutError("Test did not release the report transaction.")
        return super()._metrics_summary(
            connection,
            include_submitted=include_submitted,
            period_id=period_id,
        )


def _event(direction: str) -> dict[str, Any]:
    return {
        "camera_id": 1,
        "central_camera_id": "11111111-1111-4111-8111-111111111111",
        "camera_name": "Test Camera",
        "direction": direction,
        "track_id": 1,
        "counts": {"entry": 1, "exit": 0, "occupancy": 1},
    }


def _report_submission_request_payload(
    *, payload: dict[str, Any], unique_count: int = 1
) -> dict[str, Any]:
    return {
        "report_id": "REP-JUNE",
        "period_id": JUNE_PERIOD_ID,
        "source_window": {
            "start": "2026-05-31T16:00:00Z",
            "end": "2026-06-30T16:00:00Z",
        },
        "metrics": {
            "entries": 25,
            "exits": 2,
            "peak_occupancy": 20,
            "unique_count": unique_count,
        },
        "payload": payload,
    }


if __name__ == "__main__":
    unittest.main()
