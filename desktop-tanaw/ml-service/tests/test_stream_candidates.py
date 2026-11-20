from collections.abc import Callable

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
