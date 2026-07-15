from __future__ import annotations

import hashlib
import importlib.util
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from types import ModuleType

from app.storage.local_schema import initialize_local_database

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
EXTERNAL_MIGRATOR = REPOSITORY_ROOT / "scripts" / "migrate_local_edge_ledger_v8.py"


class LocalLedgerV8CutoverTest(unittest.TestCase):
    def test_supported_v5_v6_v7_stores_are_replaced_and_reconciled(self) -> None:
        migrator = _load_migrator()
        for version in (5, 6, 7):
            with self.subTest(version=version), tempfile.TemporaryDirectory() as directory:
                database_path = Path(directory) / "tanaw_metrics.sqlite3"
                _create_pre_cutover_store(database_path, version=version)
                with closing(sqlite3.connect(database_path)) as source:
                    source_tables = {
                        row[0]
                        for row in source.execute(
                            "select name from sqlite_master where type = 'table'"
                        )
                    }
                self.assertEqual("local_schema_migrations" in source_tables, version == 5)
                self.assertEqual("camera_runtime_state" in source_tables, version == 7)
                backup_path = migrator.migrate_local_ledger_v8(database_path)

                self.assertTrue(backup_path.exists())
                self.assertEqual(_database_version(backup_path), version)
                self.assertEqual(len(_sha256(backup_path)), 64)
                initialize_local_database(database_path)
                with closing(sqlite3.connect(database_path)) as connection:
                    self.assertEqual(connection.execute("pragma user_version").fetchone()[0], 8)
                    columns = {
                        row[1] for row in connection.execute("pragma table_info(count_events)")
                    }
                    self.assertIn("classification", columns)
                    self.assertIn("simulation_run_id", columns)
                    self.assertNotIn("source_kind", columns)
                    self.assertNotIn("mock_run_id", columns)
                    rows = connection.execute(
                        """
                        select event.classification, event.simulation_run_id,
                               camera.camera_key, camera.central_camera_id
                        from count_events as event
                        join local_cameras as camera on camera.camera_key = event.camera_key
                        order by event.camera_event_sequence
                        """
                    ).fetchall()
                    runtime_state_count = connection.execute(
                        "select count(*) from camera_runtime_state"
                    ).fetchone()[0]
                self.assertEqual(
                    [(row[0], row[1]) for row in rows],
                    [("official", None), ("simulation", "simulation-run-1")],
                )
                self.assertTrue(all(str(row[2]).startswith("camera:") for row in rows))
                self.assertTrue(
                    all(row[3] == "11111111-1111-4111-8111-111111111111" for row in rows)
                )
                self.assertEqual(runtime_state_count, 1 if version == 7 else 0)

    def test_failed_reconciliation_keeps_original_and_backup(self) -> None:
        migrator = _load_migrator()
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / "tanaw_metrics.sqlite3"
            _create_pre_cutover_store(database_path, version=7, invalid_simulation=True)
            source_checksum = _sha256(database_path)

            with self.assertRaisesRegex(RuntimeError, "no simulation run identity"):
                migrator.migrate_local_ledger_v8(database_path)

            self.assertEqual(_sha256(database_path), source_checksum)
            self.assertEqual(
                _database_version(database_path.with_name("tanaw_metrics.sqlite3.pre-v8.backup")),
                7,
            )
            self.assertFalse(
                database_path.with_name(".tanaw_metrics.sqlite3.v8.replacement").exists()
            )

    def test_external_migrator_is_excluded_from_runtime_resources(self) -> None:
        ml_service_root = REPOSITORY_ROOT / "desktop-tanaw" / "ml-service"
        self.assertTrue(EXTERNAL_MIGRATOR.is_file())
        self.assertEqual(
            list(ml_service_root.rglob("migrate_local_edge_ledger_v8.py")),
            [],
        )
        runtime_imports = "\n".join(
            path.read_text(encoding="utf-8") for path in (ml_service_root / "app").rglob("*.py")
        )
        self.assertNotIn("migrate_local_edge_ledger_v8", runtime_imports)


def _load_migrator() -> ModuleType:
    spec = importlib.util.spec_from_file_location("tanaw_external_v8_migrator", EXTERNAL_MIGRATOR)
    if spec is None or spec.loader is None:
        raise RuntimeError("External local-ledger migrator could not be loaded.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _create_pre_cutover_store(
    path: Path, *, version: int, invalid_simulation: bool = False
) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.executescript(
            """
            create table local_sites (
                local_site_id text primary key, enterprise_id text unique,
                display_name text, created_at text not null, updated_at text not null
            );
            create table local_cameras (
                camera_key text primary key, local_site_id text not null,
                central_camera_id text unique, local_camera_id integer, display_name text,
                first_seen_at text not null, last_seen_at text not null
            );
            create table reporting_periods (
                period_id text primary key, period_type text not null, timezone text not null,
                business_start_date text not null, business_end_date_exclusive text not null,
                starts_at_utc text not null, ends_at_utc text not null, label text not null,
                created_at text not null
            );
            create table local_camera_event_sequences (
                camera_key text primary key, next_sequence integer not null
            );
            create table camera_live_state (
                camera_key text primary key, observed_at text not null, state text not null,
                running integer not null, entry_count integer not null,
                exit_count integer not null, occupancy_count integer not null,
                error_summary text
            );
            create table count_events (
                event_id text primary key, recorded_at text not null, business_date text not null,
                reporting_period_id text not null, camera_key text not null,
                camera_event_sequence integer not null, camera_id integer, camera_name text,
                direction text not null, track_id integer, entry_count integer not null,
                exit_count integer not null, occupancy_count integer not null, visitor_id text,
                is_unique_entry integer not null, reid_score real, reid_decision text,
                identity_confidence text, payload_schema_version integer not null,
                attributes_json text not null, source_kind text not null, mock_run_id text
            );
            """
        )
        period_id = "month:Asia/Manila:2026-07"
        connection.execute(
            "insert into local_sites values ('primary', 'enterprise-1', 'Enterprise', ?, ?)",
            ("2026-07-01T00:00:00+00:00", "2026-07-01T00:00:00+00:00"),
        )
        connection.execute(
            "insert into local_cameras values (?, 'primary', ?, 1, 'Main Entrance', ?, ?)",
            (
                "11111111-1111-4111-8111-111111111111",
                "11111111-1111-4111-8111-111111111111",
                "2026-07-01T00:00:00+00:00",
                "2026-07-02T00:00:00+00:00",
            ),
        )
        connection.execute(
            "insert into reporting_periods values (?, 'month', 'Asia/Manila', ?, ?, ?, ?, ?, ?)",
            (
                period_id,
                "2026-07-01",
                "2026-08-01",
                "2026-06-30T16:00:00+00:00",
                "2026-07-31T16:00:00+00:00",
                "Jul 1 - Jul 31, 2026",
                "2026-07-01T00:00:00+00:00",
            ),
        )
        connection.execute(
            "insert into local_camera_event_sequences values (?, 2)",
            ("11111111-1111-4111-8111-111111111111",),
        )
        connection.execute(
            "insert into camera_live_state values (?, ?, 'running', 1, 2, 0, 2, null)",
            (
                "11111111-1111-4111-8111-111111111111",
                "2026-07-02T01:00:00+00:00",
            ),
        )
        if version == 5:
            connection.execute(
                """
                create table local_schema_migrations (
                    version integer primary key, name text not null unique, applied_at text not null
                )
                """
            )
            connection.executemany(
                "insert into local_schema_migrations values (?, ?, ?)",
                [
                    (
                        applied_version,
                        f"installed_v{applied_version}",
                        "2026-07-01T00:00:00+00:00",
                    )
                    for applied_version in range(1, 6)
                ],
            )
        if version == 7:
            connection.execute(
                """
                create table camera_runtime_state (
                    camera_key text primary key, snapshot_json text not null, updated_at text not null
                )
                """
            )
            connection.execute(
                "insert into camera_runtime_state values (?, '{}', ?)",
                (
                    "11111111-1111-4111-8111-111111111111",
                    "2026-07-02T01:00:00+00:00",
                ),
            )
        for sequence, source_kind, run_id in (
            (0, "real", None),
            (1, "mock", None if invalid_simulation else "simulation-run-1"),
        ):
            connection.execute(
                """
                insert into count_events values (
                    ?, ?, '2026-07-02', ?, ?, ?, 1, 'Main Entrance', 'entry', ?,
                    1, 0, ?, null, 1, null, null, null, 1, '{}', ?, ?
                )
                """,
                (
                    f"event-{sequence}",
                    f"2026-07-02T0{sequence}:00:00+00:00",
                    period_id,
                    "11111111-1111-4111-8111-111111111111",
                    sequence,
                    sequence,
                    sequence + 1,
                    source_kind,
                    run_id,
                ),
            )
        connection.execute(f"pragma user_version = {version}")
        connection.commit()
    finally:
        connection.close()


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _database_version(path: Path) -> int:
    with closing(sqlite3.connect(path)) as connection:
        return int(connection.execute("pragma user_version").fetchone()[0])


if __name__ == "__main__":
    unittest.main()
