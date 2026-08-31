import sqlite3
import unittest
from contextlib import closing

from app.storage.migrations import (
    DEFAULT_MIGRATIONS,
    LATEST_REVISION,
    Migration,
    UnsupportedLocalDatabaseError,
    migrate,
    migration_status,
)


class LocalDataMigrationsTest(unittest.TestCase):
    def test_fresh_database_applies_and_records_initial_schema(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            connection.execute("pragma foreign_keys = on")

            status = migrate(connection)

            tables = {
                str(row[0])
                for row in connection.execute("select name from sqlite_master where type = 'table'")
                if not str(row[0]).startswith("sqlite_")
            }
            self.assertEqual(
                tables,
                {
                    "schema_migrations",
                    "camera_profiles",
                    "camera_monitoring_states",
                    "enterprise_occupancy_state",
                    "count_events",
                    "report_submissions",
                    "report_drafts",
                    "report_camera_totals",
                    "occupancy_corrections",
                    "visitor_identities",
                    "visitor_identity_prototypes",
                    "visitor_model_embeddings",
                    "visitor_sightings",
                },
            )
            self.assertEqual(status.current_revision, "001")
            self.assertEqual(status.pending_revisions, ())
            migration_row = connection.execute(
                "select revision, checksum, applied_at from schema_migrations"
            ).fetchone()
            self.assertIsNotNone(migration_row)
            assert migration_row is not None
            self.assertEqual(migration_row[0], LATEST_REVISION)
            self.assertEqual(migration_row[1], DEFAULT_MIGRATIONS[0].checksum)
            self.assertTrue(migration_row[2])

    def test_initial_schema_contains_expected_columns_constraints_and_indexes(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            connection.execute("pragma foreign_keys = on")
            migrate(connection)

            camera_columns = {
                str(row[1]): row for row in connection.execute("pragma table_info(camera_profiles)")
            }
            self.assertIn("processing_profile", camera_columns)
            self.assertEqual(camera_columns["counting_confidence"][3], 1)

            count_event_foreign_keys = connection.execute(
                "pragma foreign_key_list(count_events)"
            ).fetchall()
            self.assertTrue(
                any(
                    row[2] == "report_submissions"
                    and row[3] == "submitted_report_id"
                    and row[4] == "report_id"
                    and row[6] == "SET NULL"
                    for row in count_event_foreign_keys
                )
            )

            count_event_indexes = {
                str(row[1]) for row in connection.execute("pragma index_list(count_events)")
            }
            self.assertIn("idx_count_events_recorded_at", count_event_indexes)
            self.assertIn("idx_count_events_camera_recorded_at", count_event_indexes)
            self.assertIn("idx_count_events_submitted_report_id", count_event_indexes)

            camera_sql = str(
                connection.execute(
                    "select sql from sqlite_master where type = 'table' and name = 'camera_profiles'"
                ).fetchone()[0]
            )
            self.assertIn("status in ('untested', 'online', 'offline'", camera_sql)

    def test_reopening_current_database_does_not_reapply_initial_schema(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            first_status = migrate(connection)
            first_record = connection.execute(
                "select revision, checksum, applied_at from schema_migrations"
            ).fetchone()

            second_status = migrate(connection)
            second_records = connection.execute(
                "select revision, checksum, applied_at from schema_migrations"
            ).fetchall()

            self.assertEqual(first_status, second_status)
            self.assertEqual(second_records, [first_record])

    def test_migrations_are_applied_in_deterministic_revision_order(self) -> None:
        applied: list[str] = []

        def upgrade_001(connection: sqlite3.Connection) -> None:
            applied.append("001")
            connection.execute("create table migration_probe (value text not null)")

        def upgrade_002(connection: sqlite3.Connection) -> None:
            applied.append("002")
            connection.execute("insert into migration_probe (value) values ('preserved')")

        migrations = (
            Migration("002", "second", "001", "checksum-002", upgrade_002),
            Migration("001", "first", None, "checksum-001", upgrade_001),
        )
        with closing(sqlite3.connect(":memory:")) as connection:
            status = migrate(connection, migrations)

            self.assertEqual(applied, ["001", "002"])
            self.assertEqual(status.applied_revisions, ("001", "002"))
            self.assertEqual(
                connection.execute("select value from migration_probe").fetchone(),
                ("preserved",),
            )

    def test_test_only_second_migration_preserves_initial_schema_data(self) -> None:
        def upgrade_002(connection: sqlite3.Connection) -> None:
            connection.execute("alter table report_drafts add column migration_note text")

        test_migration = Migration(
            "002",
            "test_preserves_data",
            "001",
            "test-checksum-002",
            upgrade_002,
        )
        with closing(sqlite3.connect(":memory:")) as connection:
            migrate(connection)
            connection.execute(
                """
                insert into report_drafts (draft_key, period, payload_json, updated_at)
                values ('draft-1', 'August 2026', '{"entries": 4}', '2026-09-01T00:00:00Z')
                """
            )
            connection.commit()

            status = migrate(connection, (*DEFAULT_MIGRATIONS, test_migration))

            self.assertEqual(status.current_revision, "002")
            self.assertEqual(
                connection.execute(
                    "select period, payload_json from report_drafts where draft_key = 'draft-1'"
                ).fetchone(),
                ("August 2026", '{"entries": 4}'),
            )

    def test_failed_migration_rolls_back_and_is_not_recorded(self) -> None:
        def failing_upgrade(connection: sqlite3.Connection) -> None:
            connection.execute("create table migration_probe (value text not null)")
            connection.execute("insert into migration_probe (value) values ('partial')")
            raise RuntimeError("simulated migration failure")

        failing_migration = Migration(
            "002",
            "fails",
            "001",
            "test-checksum-failed-002",
            failing_upgrade,
        )
        with closing(sqlite3.connect(":memory:")) as connection:
            migrate(connection)

            with self.assertRaisesRegex(RuntimeError, "simulated migration failure"):
                migrate(connection, (*DEFAULT_MIGRATIONS, failing_migration))

            self.assertIsNone(
                connection.execute(
                    "select name from sqlite_master where type = 'table' and name = 'migration_probe'"
                ).fetchone()
            )
            self.assertEqual(
                connection.execute(
                    "select revision from schema_migrations order by revision"
                ).fetchall(),
                [("001",)],
            )

    def test_database_newer_than_application_is_rejected(self) -> None:
        with closing(sqlite3.connect(":memory:")) as connection:
            migrate(connection)
            connection.execute(
                "insert into schema_migrations (revision, checksum) values ('002', 'future')"
            )
            connection.commit()

            with self.assertRaisesRegex(
                UnsupportedLocalDatabaseError,
                "latest revision understood by this application is 001",
            ):
                migrate(connection)

            status = migration_status(connection)
            self.assertFalse(status.is_supported)
            self.assertEqual(status.current_revision, "002")


if __name__ == "__main__":
    unittest.main()
