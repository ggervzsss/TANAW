import hashlib
import socket
import threading
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from unittest.mock import Mock, patch

from app.camera.rtsp_diagnosis import FAILURE_MESSAGES, diagnose_rtsp
from app.camera.stream_reader import probe_stream

REALM = "IP Camera"
NONCE = "abc123"

Responder = Callable[[str], str]


@contextmanager
def rtsp_server(respond: Responder) -> Iterator[int]:
    """A local RTSP endpoint answering each request with ``respond(request_text)``."""
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(4)
    server.settimeout(5)
    stop = threading.Event()

    def serve() -> None:
        while not stop.is_set():
            try:
                connection, _ = server.accept()
            except OSError:
                return
            with connection:
                data = b""
                while b"\r\n\r\n" not in data:
                    chunk = connection.recv(4096)
                    if not chunk:
                        break
                    data += chunk
                connection.sendall(respond(data.decode("latin-1")).encode("latin-1"))

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    try:
        yield server.getsockname()[1]
    finally:
        stop.set()
        server.close()
        thread.join(timeout=5)


def digest_camera(username: str, password: str, *, path_exists: bool = True) -> Responder:
    """A camera that asks for Digest authentication, as Tapo, Dahua, and Tenda do."""

    def respond(request: str) -> str:
        request_line, *headers = request.split("\r\n")
        cseq = next(line.split(":", 1)[1].strip() for line in headers if line.startswith("CSeq"))
        authorization = next(
            (line.split(":", 1)[1].strip() for line in headers if line.startswith("Authorization")),
            None,
        )
        if authorization is None or not _valid_digest(
            authorization, request_line, username, password
        ):
            return (
                f"RTSP/1.0 401 Unauthorized\r\nCSeq: {cseq}\r\n"
                f'WWW-Authenticate: Digest realm="{REALM}", nonce="{NONCE}"\r\n\r\n'
            )
        status = "200 OK" if path_exists else "404 Not Found"
        return f"RTSP/1.0 {status}\r\nCSeq: {cseq}\r\n\r\n"

    return respond


def _valid_digest(authorization: str, request_line: str, username: str, password: str) -> bool:
    fields = dict(
        part.strip().split("=", 1) for part in authorization.removeprefix("Digest ").split(",")
    )
    values = {name: value.strip('"') for name, value in fields.items()}
    uri = request_line.split(" ")[1]
    ha1 = hashlib.md5(f"{username}:{REALM}:{password}".encode()).hexdigest()
    ha2 = hashlib.md5(f"DESCRIBE:{uri}".encode()).hexdigest()
    expected = hashlib.md5(f"{ha1}:{NONCE}:{ha2}".encode()).hexdigest()
    return values.get("username") == username and values.get("response") == expected


def closed_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def test_wrong_username_or_password_is_reported_as_refused_login() -> None:
    with rtsp_server(digest_camera("admin", "right")) as port:
        assert diagnose_rtsp(f"rtsp://admin:wrong@127.0.0.1:{port}/stream2") == "auth_failed"
        assert diagnose_rtsp(f"rtsp://intruder:right@127.0.0.1:{port}/stream2") == "auth_failed"


def test_missing_credentials_are_reported_as_refused_login() -> None:
    with rtsp_server(digest_camera("admin", "right")) as port:
        assert diagnose_rtsp(f"rtsp://127.0.0.1:{port}/stream2") == "auth_failed"


def test_accepted_login_on_a_missing_path_is_reported_as_stream_not_found() -> None:
    with rtsp_server(digest_camera("admin", "p@ss word", path_exists=False)) as port:
        url = f"rtsp://admin:p%40ss%20word@127.0.0.1:{port}/cam/realmonitor?channel=1&subtype=1"
        assert diagnose_rtsp(url) == "stream_not_found"


def test_accepted_login_on_a_working_path_is_unknown() -> None:
    with rtsp_server(digest_camera("admin", "right")) as port:
        assert diagnose_rtsp(f"rtsp://admin:right@127.0.0.1:{port}/stream2") == "unknown"


def test_basic_authentication_is_supported() -> None:
    def respond(request: str) -> str:
        if "Authorization: Basic YWRtaW46cmlnaHQ=" in request:
            return "RTSP/1.0 404 Not Found\r\nCSeq: 2\r\n\r\n"
        return 'RTSP/1.0 401 Unauthorized\r\nCSeq: 1\r\nWWW-Authenticate: Basic realm="cam"\r\n\r\n'

    with rtsp_server(respond) as port:
        assert diagnose_rtsp(f"rtsp://admin:right@127.0.0.1:{port}/live") == "stream_not_found"
        assert diagnose_rtsp(f"rtsp://admin:wrong@127.0.0.1:{port}/live") == "auth_failed"


def test_closed_port_is_reported_as_unreachable() -> None:
    assert diagnose_rtsp(f"rtsp://admin:pw@127.0.0.1:{closed_port()}/stream2") == "unreachable"


def test_a_non_rtsp_answer_is_unknown() -> None:
    with rtsp_server(lambda _request: "HTTP/1.1 400 Bad Request\r\n\r\n") as port:
        assert diagnose_rtsp(f"rtsp://admin:pw@127.0.0.1:{port}/stream2") == "unknown"


def test_non_rtsp_addresses_are_unknown() -> None:
    assert diagnose_rtsp("http://192.168.1.20/video") == "unknown"


def test_probe_reports_the_diagnosed_reason_when_the_stream_does_not_open() -> None:
    capture = Mock()
    capture.isOpened.return_value = False
    with (
        patch("app.camera.stream_reader.open_capture", return_value=capture),
        patch("app.camera.stream_reader.diagnose_rtsp", return_value="auth_failed") as diagnose,
    ):
        result = probe_stream("rtsp://admin:wrong@192.168.1.20/stream2")
    diagnose.assert_called_once_with("rtsp://admin:wrong@192.168.1.20/stream2")
    assert not result.ok
    assert result.reason == "auth_failed"
    assert result.message == FAILURE_MESSAGES["auth_failed"]
    capture.release.assert_called_once()
