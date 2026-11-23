import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from support.cameras import FakePipeline

from app.camera.pipeline_manager import CameraPipelineRegistry
from app.storage.local_data_schema import (
    SET_ASIDE_DIRECTORY,
    LocalDatabaseResetRequiredError,
    local_database_needs_reset,
)
from app.storage.local_data_store import LocalDataStore
from app.storage.local_database import LocalDatabase

ENTERPRISE = "park@example.test"


def make_unreadable(directory: str) -> Path:
    """Create the enterprise database, then give it a baseline this version does not know."""
    LocalDataStore(directory, ENTERPRISE).metrics_summary()
    path = LocalDatabase(directory, ENTERPRISE).path
    with closing(sqlite3.connect(path)) as connection:
        connection.execute("update schema_migrations set checksum = 'earlier-baseline'")
        connection.commit()
    return path


class LocalDataResetTest(unittest.TestCase):
    def setUp(self) -> None:
        summary_worker = patch.object(CameraPipelineRegistry, "_start_summary_worker")
        summary_worker.start()
        self.addCleanup(summary_worker.stop)

    def test_unreadable_data_is_set_aside_and_binding_starts_fresh(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = make_unreadable(directory)
            registry = CameraPipelineRegistry(directory, pipeline_factory=FakePipeline)

            message = "saved by an earlier version and cannot be upgraded"
            with self.assertRaisesRegex(LocalDatabaseResetRequiredError, message):
                registry.bind_enterprise(ENTERPRISE)
            # A failed binding is not remembered as bound, so retrying fails the same way.
            with self.assertRaises(LocalDatabaseResetRequiredError):
                registry.bind_enterprise(ENTERPRISE)

            result = registry.reset_unreadable_local_data(f" {ENTERPRISE} ")

            set_aside = Path(result["set_aside_path"])
            self.assertEqual(result["enterprise_id"], ENTERPRISE)
            self.assertEqual(set_aside.parent.name, SET_ASIDE_DIRECTORY)
            self.assertTrue((set_aside / path.name).exists())
            self.assertFalse(path.parent.exists())
            self.assertTrue(registry.bind_enterprise(ENTERPRISE)["changed"])
            self.assertEqual(registry.list_camera_profiles(), [])
            self.assertFalse(local_database_needs_reset(path))

    def test_readable_or_open_data_is_never_reset(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(directory, pipeline_factory=FakePipeline)

            with self.assertRaisesRegex(ValueError, "nothing was reset"):
                registry.reset_unreadable_local_data(ENTERPRISE)

            LocalDataStore(directory, "other@example.test").metrics_summary()
            with self.assertRaisesRegex(ValueError, "nothing was reset"):
                registry.reset_unreadable_local_data("other@example.test")

            registry.bind_enterprise(ENTERPRISE)
            with self.assertRaisesRegex(ValueError, "open and readable"):
                registry.reset_unreadable_local_data(ENTERPRISE)
            self.assertTrue(LocalDatabase(directory, "other@example.test").path.exists())


if __name__ == "__main__":
    unittest.main()
