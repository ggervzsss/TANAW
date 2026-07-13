from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import select
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import IO, cast
from uuid import uuid4


@dataclass
class RunningService:
    capability: str
    launch_id: str
    process: subprocess.Popen[bytes]
    readiness: dict[str, object]


@unittest.skipIf(os.name == "nt", "pass_fds process verification is POSIX-specific")
class LocalServiceProcessSecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        self._last_capability = ""
        self._last_launch_id = ""

    def test_ephemeral_child_identity_ignores_rogue_fixed_port_and_rotates_on_restart(self) -> None:
        rogue = self._start_rogue_fixed_port()
        first: RunningService | None = None
        second: RunningService | None = None
        try:
            first = self._start_service()
            self.assertNotEqual(first.readiness["port"], 8765)
            self.assertEqual(first.readiness["pid"], first.process.pid)
            self.assertEqual(first.readiness["launchId"], first.launch_id)
            self.assertEqual(_request_status(first, "/health"), 401)
            self.assertEqual(_request_status(first, "/health", capability=_capability()), 401)
            self._assert_health_challenge(first)

            self._stop_service(first)
            first = None
            second = self._start_service()
            self.assertNotEqual(second.launch_id, first_launch_id := self._last_launch_id)
            self.assertNotEqual(second.capability, self._last_capability)
            self.assertEqual(
                _request_status(
                    second,
                    "/health",
                    capability=self._last_capability,
                    launch_id=first_launch_id,
                ),
                401,
            )
            self._assert_health_challenge(second)
            if rogue is not None:
                self.assertEqual(_RogueHandler.request_count, 0)
        finally:
            if first is not None:
                self._stop_service(first)
            if second is not None:
                self._stop_service(second)
            if rogue is not None:
                rogue.shutdown()
                rogue.server_close()

    def _start_service(self) -> RunningService:
        capability = _capability()
        launch_id = str(uuid4())
        read_fd, write_fd = os.pipe()
        environment = dict(os.environ)
        environment.pop("TANAW_ML_SERVICE_PORT", None)
        environment.pop("TANAW_ML_SERVICE_HOST", None)
        temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(temporary_directory.cleanup)
        environment["TANAW_APP_DATA_DIR"] = temporary_directory.name
        command = [
            sys.executable,
            "main.py",
            "--stdio-bootstrap",
            "--control-fd",
            str(write_fd),
        ]
        process = subprocess.Popen(
            command,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=environment,
            pass_fds=(write_fd,),
        )
        os.close(write_fd)
        assert process.stdin is not None
        process.stdin.write(
            json.dumps(
                {
                    "capability": capability,
                    "contractVersion": 2,
                    "launchId": launch_id,
                }
            ).encode()
        )
        process.stdin.close()

        ready, _, _ = select.select([read_fd], [], [], 15)
        if not ready:
            process.kill()
            stderr = _read_stream(process.stderr)
            self.fail(f"ML service readiness timed out: {stderr}")
        raw_readiness = os.read(read_fd, 4096)
        os.close(read_fd)
        readiness = json.loads(raw_readiness)
        self.assertNotIn(capability, raw_readiness.decode())
        self.assertNotIn(capability, " ".join(command))
        self.assertNotIn(capability, json.dumps(environment))

        service = RunningService(
            capability=capability,
            launch_id=launch_id,
            process=process,
            readiness=readiness,
        )
        self._wait_for_health(service)
        return service

    def _wait_for_health(self, service: RunningService) -> None:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if _request_status(service, "/health") == 401:
                return
            time.sleep(0.05)
        self.fail("ML service did not begin accepting authenticated requests.")

    def _assert_health_challenge(self, service: RunningService) -> None:
        challenge = secrets.token_urlsafe(24)
        payload = _request_json(service, challenge)
        startup_nonce = str(service.readiness["startupNonce"])
        expected = _base64url(
            hmac.new(
                service.capability.encode(),
                f"health:{service.launch_id}:{startup_nonce}:{challenge}".encode(),
                hashlib.sha256,
            ).digest()
        )
        self.assertEqual(payload["challengeResponse"], expected)
        self.assertEqual(payload["pid"], service.process.pid)
        self.assertNotIn(service.capability, json.dumps(payload))

    def _stop_service(self, service: RunningService) -> None:
        self._last_capability = service.capability
        self._last_launch_id = service.launch_id
        service.process.terminate()
        try:
            service.process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            service.process.kill()
            service.process.wait(timeout=3)
        output = _read_stream(service.process.stdout) + _read_stream(service.process.stderr)
        self.assertNotIn(service.capability, output)

    def _start_rogue_fixed_port(self) -> ThreadingHTTPServer | None:
        _RogueHandler.request_count = 0
        try:
            server = ThreadingHTTPServer(("127.0.0.1", 8765), _RogueHandler)
        except OSError:
            return None
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return server


class _RogueHandler(BaseHTTPRequestHandler):
    request_count = 0

    def do_GET(self) -> None:
        type(self).request_count += 1
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"ok"}')

    def log_message(self, format: str, *args: object) -> None:
        del format, args


def _request_status(
    service: RunningService,
    path: str,
    capability: str | None = None,
    launch_id: str | None = None,
) -> int:
    headers: dict[str, str] = {}
    if capability is not None:
        headers["Authorization"] = f"TANAW-Capability {capability}"
        headers["X-TANAW-Launch-ID"] = launch_id or service.launch_id
    request = urllib.request.Request(_service_url(service, path), headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=1) as response:
            return int(response.status)
    except urllib.error.HTTPError as exc:
        try:
            return exc.code
        finally:
            exc.close()
    except (TimeoutError, urllib.error.URLError):
        return 0


def _request_json(service: RunningService, challenge: str) -> dict[str, object]:
    request = urllib.request.Request(
        _service_url(service, "/health"),
        headers={
            "Authorization": f"TANAW-Capability {service.capability}",
            "X-TANAW-Launch-ID": service.launch_id,
            "X-TANAW-Health-Challenge": challenge,
        },
    )
    with urllib.request.urlopen(request, timeout=2) as response:
        payload = json.loads(response.read())
        if not isinstance(payload, dict):
            raise AssertionError("Health response was not an object.")
        return cast(dict[str, object], payload)


def _service_url(service: RunningService, path: str) -> str:
    return f"http://127.0.0.1:{service.readiness['port']}{path}"


def _read_stream(stream: IO[bytes] | None) -> str:
    if stream is None:
        return ""
    try:
        return stream.read().decode(errors="replace")
    finally:
        stream.close()


def _capability() -> str:
    return _base64url(secrets.token_bytes(32))


def _base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


if __name__ == "__main__":
    unittest.main()
