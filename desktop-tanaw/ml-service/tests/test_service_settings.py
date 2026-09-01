import importlib
import os
import unittest
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.camera.pipeline_manager import CameraPipelineRegistry
from app.config.service_settings import ServiceSettings, is_loopback_bind_host
from app.main import create_app


class ServiceSettingsSecurityTest(unittest.TestCase):
    def test_loopback_managed_token_and_standalone_mode_are_allowed(self) -> None:
        self.assertEqual(ServiceSettings(bind_host="127.0.0.1").access_token, "")
        self.assertEqual(
            ServiceSettings(
                bind_host="127.0.0.1", access_token="managed-launch-token"
            ).access_token,
            "managed-launch-token",
        )

    def test_ipv4_and_ipv6_loopback_addresses_are_classified_safely(self) -> None:
        self.assertTrue(is_loopback_bind_host("127.0.0.1"))
        self.assertTrue(is_loopback_bind_host("127.20.30.40"))
        self.assertTrue(is_loopback_bind_host("::1"))
        self.assertTrue(is_loopback_bind_host("localhost"))
        self.assertFalse(is_loopback_bind_host("0.0.0.0"))
        self.assertFalse(is_loopback_bind_host("::"))
        self.assertFalse(is_loopback_bind_host("192.168.1.20"))

    def test_non_loopback_bind_rejects_missing_blank_and_weak_tokens(self) -> None:
        for token in ("", "   ", "too-short", "x" * 31, f"{'x' * 31} "):
            with self.subTest(token=repr(token)):
                with self.assertRaisesRegex(ValueError, "at least 32 non-whitespace"):
                    ServiceSettings(bind_host="0.0.0.0", access_token=token)

    def test_non_loopback_bind_accepts_a_strong_token(self) -> None:
        token = "a" * 64

        settings = ServiceSettings(bind_host="0.0.0.0", access_token=token)

        self.assertEqual(settings.bind_host, "0.0.0.0")
        self.assertEqual(settings.access_token, token)

    def test_non_loopback_service_with_a_strong_token_remains_authenticated(self) -> None:
        token = "a" * 64
        with TemporaryDirectory() as directory:
            application = create_app(
                registry=CameraPipelineRegistry(directory),
                settings=ServiceSettings(bind_host="0.0.0.0", access_token=token),
            )
            with TestClient(application) as client:
                unauthorized = client.get("/health")
                authorized = client.get("/health", headers={"X-TANAW-ML-Token": token})

        self.assertEqual(unauthorized.status_code, 401)
        self.assertEqual(authorized.status_code, 200)

    def test_environment_validation_rejects_unsafe_configuration_before_server_start(self) -> None:
        service_entrypoint = importlib.import_module("main")
        with (
            patch.dict(
                os.environ,
                {"TANAW_ML_SERVICE_HOST": "0.0.0.0", "TANAW_ML_SERVICE_TOKEN": ""},
                clear=False,
            ),
            patch.object(service_entrypoint.uvicorn, "run") as run_server,
        ):
            with self.assertRaisesRegex(ValueError, "TANAW_ML_SERVICE_TOKEN"):
                service_entrypoint.main()

        run_server.assert_not_called()

    def test_electron_managed_environment_remains_valid(self) -> None:
        token = "e" * 64
        with patch.dict(
            os.environ,
            {"TANAW_ML_SERVICE_HOST": "127.0.0.1", "TANAW_ML_SERVICE_TOKEN": token},
            clear=False,
        ):
            settings = ServiceSettings.from_environment()

        self.assertEqual(settings.bind_host, "127.0.0.1")
        self.assertEqual(settings.access_token, token)


if __name__ == "__main__":
    unittest.main()
