import unittest
from tempfile import TemporaryDirectory

from app.camera.pipeline_manager import CameraPipelineRegistry
from app.main import (
    API_CONTRACT_VERSION,
    SERVICE_VERSION,
    app,
    build_health_payload,
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


if __name__ == "__main__":
    unittest.main()
