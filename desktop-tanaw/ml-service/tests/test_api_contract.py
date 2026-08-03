import unittest
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient

from app.camera.pipeline_manager import CameraPipelineRegistry
from app.config.service_settings import ServiceSettings
from app.main import (
    API_CONTRACT_VERSION,
    SERVICE_VERSION,
    app,
    build_health_payload,
    create_app,
    has_valid_desktop_access_token,
)


class ApiContractTest(unittest.TestCase):
    def test_desktop_token_validation_is_constant_time_and_opt_in(self) -> None:
        self.assertTrue(has_valid_desktop_access_token("", ""))
        self.assertTrue(has_valid_desktop_access_token("launch-secret", "launch-secret"))
        self.assertFalse(has_valid_desktop_access_token("wrong", "launch-secret"))

    def test_multi_camera_runtime_routes_are_registered(self) -> None:
        http_routes = {
            (method, path)
            for route in app.routes
            if isinstance((path := getattr(route, "path", None)), str)
            for method in getattr(route, "methods", set())
        }
        websocket_routes = {
            path
            for route in app.routes
            if route.__class__.__name__ == "APIWebSocketRoute"
            and isinstance((path := getattr(route, "path", None)), str)
        }

        self.assertIn(("GET", "/cameras/runtime"), http_routes)
        self.assertIn(("POST", "/camera/start"), http_routes)
        self.assertIn(("PATCH", "/camera/{camera_id}/counting-config"), http_routes)
        self.assertIn(("GET", "/camera/{camera_id}/stream"), http_routes)
        self.assertIn(("POST", "/reports/local-submit"), http_routes)
        self.assertIn(("GET", "/reports/local"), http_routes)
        self.assertIn("/camera/ws", websocket_routes)
        self.assertNotIn(("GET", "/counts"), http_routes)
        self.assertNotIn(("GET", "/detections"), http_routes)
        self.assertNotIn(("POST", "/session/restore"), http_routes)
        start_route = next(
            route for route in app.routes if getattr(route, "path", None) == "/camera/start"
        )
        self.assertEqual(getattr(start_route, "status_code", None), 202)

    def test_health_identifies_the_runtime_contract(self) -> None:
        with TemporaryDirectory() as directory:
            health = build_health_payload(CameraPipelineRegistry(directory))

        self.assertEqual(health["service_version"], SERVICE_VERSION)
        self.assertEqual(health["api_contract_version"], API_CONTRACT_VERSION)
        self.assertEqual(API_CONTRACT_VERSION, 9)
        self.assertTrue(health["tripwire_hot_update"])
        self.assertEqual(health["max_configured_cameras"], 6)
        self.assertEqual(health["max_concurrent_cameras"], 6)

    def test_app_factory_injects_registry_and_enforces_launch_token(self) -> None:
        with TemporaryDirectory() as directory:
            registry = CameraPipelineRegistry(directory)
            application = create_app(
                registry=registry,
                settings=ServiceSettings(access_token="launch-secret"),
            )
            with TestClient(application) as client:
                unauthorized = client.get("/health")
                authorized = client.get("/health", headers={"X-TANAW-ML-Token": "launch-secret"})

            self.assertEqual(unauthorized.status_code, 401)
            self.assertEqual(authorized.status_code, 200)
            self.assertEqual(authorized.json()["api_contract_version"], API_CONTRACT_VERSION)

    def test_authenticated_camera_websocket_exposes_typed_runtime_envelope(self) -> None:
        with TemporaryDirectory() as directory:
            application = create_app(
                registry=CameraPipelineRegistry(directory),
                settings=ServiceSettings(access_token="launch-secret"),
            )
            with TestClient(application) as client:
                with client.websocket_connect("/camera/ws?access_token=launch-secret") as websocket:
                    envelope = websocket.receive_json()

            self.assertEqual(envelope["type"], "camera.states")
            self.assertEqual(envelope["data"]["active_camera_count"], 0)
            self.assertEqual(envelope["data"]["cameras"], [])


if __name__ == "__main__":
    unittest.main()
