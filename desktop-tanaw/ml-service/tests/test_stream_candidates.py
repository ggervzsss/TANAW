from collections.abc import Callable

from app.camera.rtsp_diagnosis import ConnectionFailureReason
from app.camera.stream_candidates import (
    StreamProbe,
    StreamSelection,
    select_stream,
    stream_candidates,
)

HOST = "192.168.1.20"


def probe_from(
    sizes: dict[str, tuple[int, int] | None],
) -> tuple[Callable[[str], StreamProbe], list[str]]:
    calls: list[str] = []

    def probe(url: str) -> StreamProbe:
        plain = url.replace("admin:secret@", "")
        calls.append(plain)
        size = sizes.get(plain)
        if size is None:
            return StreamProbe(False, f"Unable to open {url}")
        return StreamProbe(True, "Camera stream is reachable.", *size)

    return probe, calls


def select(
    brand: str, sizes: dict[str, tuple[int, int] | None], preferred: str | None = None
) -> tuple[StreamSelection, list[str]]:
    probe, calls = probe_from(sizes)
    result = select_stream(
        brand=brand,
        host=HOST,
        username="admin",
        password="secret",
        preferred=preferred,
        probe=probe,
    )
    return result, calls


def test_candidates_prefer_sub_streams_per_brand():
    assert stream_candidates("tapo", HOST) == [f"rtsp://{HOST}/stream2"]
    assert stream_candidates("dahua", HOST) == [
        f"rtsp://{HOST}:554/cam/realmonitor?channel=1&subtype=1"
    ]
    assert stream_candidates("tenda", HOST) == [
        f"rtsp://{HOST}:554/ch=1?subtype=1",
        f"rtsp://{HOST}:8554/profile1",
        f"rtsp://{HOST}:554/ch=1&subtype=1",
        f"rtsp://{HOST}:554/H264?ch=1&subtype=1",
    ]


def test_previously_chosen_stream_is_tried_first():
    main = f"rtsp://{HOST}/stream1"
    assert stream_candidates("tapo", HOST, preferred=main) == [main, f"rtsp://{HOST}/stream2"]


def test_first_working_tenda_format_is_chosen():
    working = f"rtsp://{HOST}:8554/profile1"
    result, calls = select("tenda", {working: (640, 360)})
    assert result.ok
    assert result.stream_url == working
    assert calls[:2] == [f"rtsp://{HOST}:554/ch=1?subtype=1", working]


def test_small_sub_stream_is_replaced_by_the_main_stream():
    result, _ = select(
        "tapo",
        {f"rtsp://{HOST}/stream2": (320, 180), f"rtsp://{HOST}/stream1": (1920, 1080)},
    )
    assert result.stream_url == f"rtsp://{HOST}/stream1"
    assert (result.width, result.height) == (1920, 1080)


def test_working_stream_is_kept_when_no_size_is_ideal():
    result, _ = select("tapo", {f"rtsp://{HOST}/stream2": (320, 180)})
    assert result.ok
    assert result.stream_url == f"rtsp://{HOST}/stream2"


def test_custom_rtsp_uses_the_address_as_typed():
    typed = f"rtsp://{HOST}:7447/live/main"
    result, calls = select("custom", {typed: (2560, 1440)}, preferred=typed)
    assert result.ok and result.stream_url == typed
    assert calls == [typed]


def test_failure_reports_without_credentials():
    result, _ = select("dahua", {})
    assert not result.ok
    assert result.stream_url is None
    assert "secret" not in result.message


def probe_reasons(
    reasons: dict[str, ConnectionFailureReason],
) -> tuple[Callable[[str], StreamProbe], list[str]]:
    calls: list[str] = []

    def probe(url: str) -> StreamProbe:
        plain = url.replace("admin:secret@", "")
        calls.append(plain)
        reason = reasons[plain]
        return StreamProbe(False, f"{reason} at {url}", reason=reason)

    return probe, calls


def select_failing(
    reasons: dict[str, ConnectionFailureReason],
) -> tuple[StreamSelection, list[str]]:
    probe, calls = probe_reasons(reasons)
    result = select_stream(
        brand="tenda", host=HOST, username="admin", password="secret", preferred=None, probe=probe
    )
    return result, calls


TENDA = [
    f"rtsp://{HOST}:554/ch=1?subtype=1",
    f"rtsp://{HOST}:8554/profile1",
    f"rtsp://{HOST}:554/ch=1&subtype=1",
    f"rtsp://{HOST}:554/H264?ch=1&subtype=1",
]


def test_refused_login_stops_the_search_and_is_reported() -> None:
    result, calls = select_failing({TENDA[0]: "auth_failed"})
    assert calls == [TENDA[0]]
    assert result.reason == "auth_failed"
    assert "secret" not in result.message


def test_a_camera_that_answered_outranks_an_unreachable_port() -> None:
    reasons: dict[str, ConnectionFailureReason] = {
        TENDA[0]: "stream_not_found",
        TENDA[1]: "unreachable",
        TENDA[2]: "stream_not_found",
        TENDA[3]: "unreachable",
    }
    result, calls = select_failing(reasons)
    assert calls == TENDA
    assert result.reason == "stream_not_found"


def test_every_address_unreachable_is_reported_as_unreachable() -> None:
    result, _ = select_failing(dict.fromkeys(TENDA, "unreachable"))
    assert not result.ok
    assert result.reason == "unreachable"


def test_a_working_stream_has_no_failure_reason() -> None:
    result, _ = select("tapo", {f"rtsp://{HOST}/stream2": (1280, 720)})
    assert result.ok and result.reason is None


def test_probe_without_a_reason_is_reported_as_unknown() -> None:
    result, _ = select("dahua", {})
    assert result.reason == "unknown"
