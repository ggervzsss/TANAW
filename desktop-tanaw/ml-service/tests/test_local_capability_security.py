from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app
from app.security.local_capability import (
    LOCAL_CONTRACT_VERSION,
    LOCAL_RELEASE_ID,
    LOCAL_SERVICE_NAME,
    BootstrapError,
    LaunchBootstrap,
    ReadinessIdentity,
    build_readiness_record,
    install_launch_security,
    parse_bootstrap_payload,
)


class LocalCapabilitySecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.capability = _capability()
        self.launch_id = str(uuid4())
        self.startup_nonce = secrets.token_urlsafe(24)
        self.authority = install_launch_security(
            app,
            LaunchBootstrap(
                capability=self.capability,
                launch_id=self.launch_id,
            ),
            self.startup_nonce,
        )
        self.client = TestClient(app)

    def tearDown(self) -> None:
        self.client.close()

    def test_missing_and_wrong_master_capabilities_fail_closed(self) -> None:
        for path in ("/health", "/camera/health", "/counts", "/stream", "/sync/outbox/health"):
            missing = self.client.get(path)
            wrong = self.client.get(
                path,
                headers=_master_headers(_capability(), self.launch_id),
            )
            self.assertEqual(missing.status_code, 401, path)
            self.assertEqual(wrong.status_code, 401, path)
            self.assertEqual(missing.json(), {"detail": "Unauthorized"})
            self.assertNotIn(self.capability, missing.text)
            self.assertNotIn("Access-Control-Allow-Origin", missing.headers)

    def test_stream_and_websocket_require_scoped_sessions_not_master_capability(self) -> None:
        master_stream = self.client.get(
            "/stream",
            headers=_master_headers(self.capability, self.launch_id),
        )
        self.assertEqual(master_stream.status_code, 401)
        with self.assertRaises(WebSocketDisconnect) as raised:
            with self.client.websocket_connect(
                "/camera/ws",
                headers=_master_headers(self.capability, self.launch_id),
            ):
                pass
        self.assertEqual(raised.exception.code, 4401)

    def test_authenticated_health_proves_launch_identity(self) -> None:
        challenge = secrets.token_urlsafe(24)
        response = self.client.get(
            "/health",
            headers={
                **_master_headers(self.capability, self.launch_id),
                "X-TANAW-Health-Challenge": challenge,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["Cache-Control"], "no-store")
        payload = response.json()
        self.assertEqual(payload["serviceName"], LOCAL_SERVICE_NAME)
        self.assertEqual(payload["localContractVersion"], LOCAL_CONTRACT_VERSION)
        self.assertEqual(payload["releaseId"], LOCAL_RELEASE_ID)
        self.assertEqual(payload["launchId"], self.launch_id)
        self.assertEqual(payload["pid"], os.getpid())
        expected = _base64url(
            hmac.new(
                self.capability.encode(),
                f"health:{self.launch_id}:{self.startup_nonce}:{challenge}".encode(),
                hashlib.sha256,
            ).digest()
        )
        self.assertEqual(payload["challengeResponse"], expected)
        self.assertNotIn(self.capability, response.text)

    def test_previous_launch_capability_and_session_are_invalid_after_restart(self) -> None:
        old_session = self.authority.mint_session("stream", 30)
        new_capability = _capability()
        new_launch_id = str(uuid4())
        install_launch_security(
            app,
            LaunchBootstrap(capability=new_capability, launch_id=new_launch_id),
            secrets.token_urlsafe(24),
        )

        stale_master = self.client.get(
            "/camera/health",
            headers=_master_headers(self.capability, self.launch_id),
        )
        stale_session = self.client.get(
            "/stream",
            headers={
                "Authorization": f"TANAW-Session {old_session.token}",
                "X-TANAW-Launch-ID": self.launch_id,
            },
        )

        self.assertEqual(stale_master.status_code, 401)
        self.assertEqual(stale_session.status_code, 401)

    def test_browser_origins_are_rejected_even_with_master_authentication(self) -> None:
        response = self.client.get(
            "/camera/health",
            headers={
                **_master_headers(self.capability, self.launch_id),
                "Origin": "http://127.0.0.1:5174",
            },
        )
        self.assertEqual(response.status_code, 401)
        self.assertNotIn("Access-Control-Allow-Origin", response.headers)

    def test_session_response_never_exposes_camera_configuration_or_credentials(self) -> None:
        response = self.client.get(
            "/session",
            headers=_master_headers(self.capability, self.launch_id),
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("camera_config", response.json())
        self.assertNotIn("password", response.text.lower())
        self.assertNotIn("username", response.text.lower())

    def test_authentication_precedes_bounded_body_validation(self) -> None:
        body = b"x" * 1_048_577
        unauthenticated = self.client.post("/camera/start", content=body)
        authenticated = self.client.post(
            "/camera/start",
            content=body,
            headers=_master_headers(self.capability, self.launch_id),
        )
        self.assertEqual(unauthenticated.status_code, 401)
        self.assertEqual(authenticated.status_code, 413)

    def test_authenticated_request_rate_limit_is_bounded(self) -> None:
        self.assertTrue(self.authority.allow_request("test-bucket", 2, 10.0))
        self.assertTrue(self.authority.allow_request("test-bucket", 2, 10.0))
        self.assertFalse(self.authority.allow_request("test-bucket", 2, 10.0))

    def test_websocket_rejects_missing_wrong_and_wrong_scope_sessions(self) -> None:
        stream_session = self.authority.mint_session("stream", 30)
        attempts: tuple[tuple[dict[str, str], list[str]], ...] = (
            ({"X-TANAW-Launch-ID": self.launch_id}, []),
            ({"X-TANAW-Launch-ID": self.launch_id}, [f"tanaw-session.{_capability()}"]),
            (
                {"X-TANAW-Launch-ID": self.launch_id},
                [f"tanaw-session.{stream_session.token}"],
            ),
        )
        for headers, subprotocols in attempts:
            with self.assertRaises(WebSocketDisconnect) as raised:
                with self.client.websocket_connect(
                    "/camera/ws",
                    headers=headers,
                    subprotocols=subprotocols,
                ):
                    pass
            self.assertEqual(raised.exception.code, 4401)

    def test_scope_limited_camera_session_can_subscribe(self) -> None:
        camera_session = self.authority.mint_session("camera-events", 30)
        envelope = {
            "type": "camera.state",
            "data": {
                "counts": {"running": False},
                "detections": {},
                "health": {},
                "session": {},
            },
        }
        with (
            patch("app.main.build_health_payload", return_value={}),
            patch("app.main.build_camera_state_envelope", return_value=envelope),
            self.client.websocket_connect(
                "/camera/ws",
                subprotocols=[
                    f"tanaw-session.{camera_session.token}",
                    f"tanaw-launch.{self.launch_id}",
                ],
            ) as websocket,
        ):
            self.assertEqual(websocket.receive_json(), envelope)

    def test_outbox_routes_mutate_only_the_exact_authenticated_item(self) -> None:
        outbox_item_id = str(uuid4())
        acknowledgement = {
            "contractVersion": 2,
            "commandId": str(uuid4()),
            "disposition": "created",
            "payloadHash": f"sha256:{'a' * 64}",
            "acknowledgedAt": "2026-07-13T08:15:03.510Z",
            "resource": {
                "periodKey": "month:Asia/Manila:2026-06",
                "reportingPeriodId": str(uuid4()),
                "enterpriseReportId": str(uuid4()),
                "reportRevisionId": str(uuid4()),
                "revisionNumber": 1,
                "workflowState": "submitted",
                "logicalVersion": 1,
            },
        }
        headers = _master_headers(self.capability, self.launch_id)
        with (
            patch(
                "app.main.manager.list_ready_sync_outbox_items",
                return_value=[{"outbox_item_id": outbox_item_id}],
            ) as ready,
            patch(
                "app.main.manager.sync_outbox_health",
                return_value={
                    "pending_count": 1,
                    "oldest_pending_at": "2026-07-13T08:00:00Z",
                    "last_acknowledged_at": None,
                    "last_failure_at": "2026-07-13T08:14:00Z",
                    "last_failure_class": "network_error",
                },
            ) as health,
            patch(
                "app.main.manager.acknowledge_sync_outbox_item", return_value=True
            ) as acknowledge,
            patch(
                "app.main.manager.record_sync_outbox_failure",
                return_value={"outbox_item_id": outbox_item_id, "status": "retry"},
            ) as fail,
        ):
            health_response = self.client.get("/sync/outbox/health", headers=headers)
            ready_response = self.client.get("/sync/outbox/ready?limit=7", headers=headers)
            acknowledge_response = self.client.post(
                f"/sync/outbox/{outbox_item_id}/acknowledge",
                headers=headers,
                json={"acknowledgement": acknowledgement},
            )
            failure_response = self.client.post(
                f"/sync/outbox/{outbox_item_id}/failure",
                headers=headers,
                json={
                    "error_class": "network_error",
                    "error_message": "The central service could not be reached.",
                    "retryable": True,
                    "http_status": None,
                },
            )

        self.assertEqual(health_response.status_code, 200)
        self.assertEqual(health_response.json()["pending_count"], 1)
        self.assertEqual(ready_response.status_code, 200)
        self.assertEqual(acknowledge_response.status_code, 200)
        self.assertEqual(failure_response.status_code, 200)
        health.assert_called_once_with()
        ready.assert_called_once_with(limit=7)
        acknowledge.assert_called_once_with(
            outbox_item_id,
            acknowledgement=acknowledgement,
            acknowledged_at=acknowledgement["acknowledgedAt"],
        )
        fail.assert_called_once_with(
            outbox_item_id,
            error_class="network_error",
            error_message="The central service could not be reached.",
            retryable=True,
            http_status=None,
        )

    def test_outbox_acknowledgement_rejects_missing_exact_identity(self) -> None:
        response = self.client.post(
            f"/sync/outbox/{uuid4()}/acknowledge",
            headers=_master_headers(self.capability, self.launch_id),
            json={"acknowledgement": {"contractVersion": 2}},
        )
        self.assertEqual(response.status_code, 422)


class BootstrapContractTests(unittest.TestCase):
    def test_bootstrap_is_exact_bounded_and_single_record(self) -> None:
        payload = {
            "capability": _capability(),
            "contractVersion": LOCAL_CONTRACT_VERSION,
            "launchId": str(uuid4()),
        }
        raw = json.dumps(payload).encode()
        self.assertEqual(parse_bootstrap_payload(raw).launch_id, payload["launchId"])

        for invalid in (
            b"",
            raw + b"\n" + raw,
            json.dumps({**payload, "extra": True}).encode(),
            json.dumps({**payload, "capability": "short"}).encode(),
            b"x" * 4097,
        ):
            with self.assertRaises(BootstrapError):
                parse_bootstrap_payload(invalid)

    def test_readiness_record_contains_identity_but_never_capability(self) -> None:
        capability = _capability()
        readiness = build_readiness_record(
            ReadinessIdentity(
                launch_id=str(uuid4()),
                pid=1234,
                port=54321,
                startup_nonce=secrets.token_urlsafe(24),
            )
        )
        serialized = json.dumps(readiness)
        self.assertEqual(readiness["serviceName"], LOCAL_SERVICE_NAME)
        self.assertNotIn(capability, serialized)
        self.assertNotIn("capability", serialized.lower())


def _capability() -> str:
    return _base64url(secrets.token_bytes(32))


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _master_headers(capability: str, launch_id: str) -> dict[str, str]:
    return {
        "Authorization": f"TANAW-Capability {capability}",
        "X-TANAW-Launch-ID": launch_id,
    }


if __name__ == "__main__":
    unittest.main()
