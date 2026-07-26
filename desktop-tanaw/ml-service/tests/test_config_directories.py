import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.runtime.config_directories import configure_third_party_directories


class ThirdPartyConfigDirectoriesTest(unittest.TestCase):
    def test_uses_desktop_app_data_and_creates_writable_parents(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app_data_dir = Path(directory) / "app-data"
            environment = {"TANAW_APP_DATA_DIR": str(app_data_dir)}

            configure_third_party_directories(environment)

            expected_root = app_data_dir / "ml-service" / "third-party"
            self.assertEqual(
                environment["YOLO_CONFIG_DIR"],
                str(expected_root / "ultralytics"),
            )
            self.assertEqual(
                environment["MPLCONFIGDIR"],
                str(expected_root / "matplotlib"),
            )
            self.assertTrue((expected_root / "ultralytics").is_dir())
            self.assertTrue((expected_root / "matplotlib").is_dir())

    def test_uses_a_created_temporary_directory_without_app_data(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temp_root = Path(directory)
            environment: dict[str, str] = {}

            configure_third_party_directories(environment, temp_root=temp_root)

            expected_root = temp_root / "tanaw-ml-service"
            self.assertEqual(
                environment["YOLO_CONFIG_DIR"],
                str(expected_root / "ultralytics"),
            )
            self.assertTrue((expected_root / "ultralytics").is_dir())

    def test_preserves_explicit_directory_overrides(self) -> None:
        environment = {
            "MPLCONFIGDIR": "/custom/matplotlib",
            "YOLO_CONFIG_DIR": "/custom/ultralytics",
        }

        configure_third_party_directories(environment)

        self.assertEqual(environment["MPLCONFIGDIR"], "/custom/matplotlib")
        self.assertEqual(environment["YOLO_CONFIG_DIR"], "/custom/ultralytics")

    def test_falls_back_to_temporary_storage_when_app_data_is_unwritable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            temp_root = Path(directory)
            environment = {"TANAW_APP_DATA_DIR": "/unwritable/app-data"}

            with patch(
                "app.runtime.config_directories._create_directory",
                side_effect=[
                    None,
                    temp_root / "tanaw-ml-service" / "matplotlib",
                    None,
                    temp_root / "tanaw-ml-service" / "ultralytics",
                ],
            ):
                configure_third_party_directories(environment, temp_root=temp_root)

            self.assertEqual(
                environment["YOLO_CONFIG_DIR"],
                str(temp_root / "tanaw-ml-service" / "ultralytics"),
            )
