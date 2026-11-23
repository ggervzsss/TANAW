from typing import Any

import pytest
from pydantic import ValidationError

from app.features.monitoring.schemas import (
    MAX_BACKUP_DAYS,
    MAX_BACKUP_SERIALIZED_BYTES,
    DesktopBackupUpload,
)


def _camera_values(**overrides: Any) -> dict[str, Any]:
    return {
        "id": 1,
        "name": "Main entrance",
        "zone": "Lobby",
        "cameraHost": "192.168.1.21",
        "cameraBrand": "tapo",
        "rtspStream": "stream2",
        "rtsp": "rtsp://192.168.1.21/stream2",
        "processingProfile": "auto",
        "confidence": 0.35,
        "config": {
            "tripwire": 50,
            "roi": {"top": 0, "left": 0, "width": 100, "height": 100},
            "reverse": False,
        },
        **overrides,
    }


def test_backup_accepts_unsubmitted_days_drafts_submissions_and_cameras() -> None:
    parsed = DesktopBackupUpload.model_validate(_backup())

    assert [day.businessDate.isoformat() for day in parsed.days] == ["2026-11-15", "2026-11-16"]
    assert parsed.drafts[0].draftKey == "period:November 2026"
    assert parsed.submissions[0].submissionId == "SUB-OCT"
    assert parsed.cameras[0].rtsp == "rtsp://192.168.1.21/stream2"


@pytest.mark.parametrize(
    "rtsp",
    [
        "rtsp://192.168.1.21:554/cam/realmonitor?channel=1&subtype=1",
        "rtsp://192.168.1.21:554/ch=1?subtype=0",
        "rtsp://192.168.1.21:554/ch=1&subtype=1",
        "rtsp://192.168.1.21:8554/profile1",
        "rtsp://192.168.1.21:554/H264?ch=1&subtype=1",
    ],
)
def test_backup_keeps_vendor_stream_settings(rtsp: str) -> None:
    camera = _camera_values(cameraBrand="dahua", rtspStream=None, rtsp=rtsp)

    parsed = DesktopBackupUpload.model_validate(_backup(cameras=[camera]))

    assert parsed.cameras[0].rtsp == rtsp


def test_backup_keeps_a_custom_camera_by_host_and_port() -> None:
    camera = _camera_values(cameraBrand="custom", rtspStream=None, rtsp="rtsp://192.168.1.21:8554")

    parsed = DesktopBackupUpload.model_validate(_backup(cameras=[camera]))

    assert parsed.cameras[0].rtsp == "rtsp://192.168.1.21:8554"


@pytest.mark.parametrize(
    "camera",
    [
        _camera_values(password="secret"),
        _camera_values(username="admin"),
        _camera_values(username=None, password=""),
        _camera_values(rtsp="rtsp://admin:secret@192.168.1.21/stream2"),
        _camera_values(rtsp="rtsp://admin@192.168.1.21/stream2"),
        _camera_values(config={"source": {"stream_url": "rtsp://admin@192.168.1.21/"}}),
        _camera_values(cameraBrand="custom", rtsp="rtsp://192.168.1.21/live?token=abc123"),
        _camera_values(cameraBrand="custom", rtsp="rtsp://192.168.1.21/s3cr3t-path/live"),
        _camera_values(cameraBrand="dahua", rtsp="rtsp://192.168.1.21/cam/realmonitor?auth=x"),
        _camera_values(cameraBrand="dahua", rtsp="rtsp://192.168.1.21/stream2?channel=1&k=v"),
        _camera_values(cameraBrand="tenda", rtsp="rtsp://192.168.1.21/private/stream"),
        _camera_values(rtsp="rtsp://192.168.1.21/stream2#token"),
        _camera_values(rtsp="rtsp://192.168.1.99/stream2"),
        _camera_values(tracks=[{"track_id": 4, "embedding": [0.1, 0.2]}]),
        _camera_values(sessionToken="abc"),
        _camera_values(status="running"),
    ],
)
def test_backup_refuses_camera_data_outside_the_allowlist(camera: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        DesktopBackupUpload.model_validate(_backup(cameras=[camera]))


def test_backup_rejects_repeated_days_and_drafts() -> None:
    day = _day("2026-11-16")
    with pytest.raises(ValidationError, match="Each backed-up day"):
        DesktopBackupUpload.model_validate(_backup(days=[day, day]))

    draft = _draft()
    with pytest.raises(ValidationError, match="Each backed-up report draft"):
        DesktopBackupUpload.model_validate(_backup(drafts=[draft, draft]))


def test_backup_is_bounded() -> None:
    days = [_day(f"2026-{1 + index // 28:02d}-{1 + index % 28:02d}") for index in range(63)]
    with pytest.raises(ValidationError, match=f"at most {MAX_BACKUP_DAYS}"):
        DesktopBackupUpload.model_validate(_backup(days=days))

    oversized = {**_draft(), "payload": {"notes": "x" * MAX_BACKUP_SERIALIZED_BYTES}}
    with pytest.raises(ValidationError, match="maximum serialized size"):
        DesktopBackupUpload.model_validate(_backup(drafts=[oversized]))


def test_backup_rejects_repeated_submissions_and_cameras() -> None:
    submission = _submission()
    with pytest.raises(ValidationError, match="Each backed-up report submission"):
        DesktopBackupUpload.model_validate(_backup(submissions=[submission, submission]))

    with pytest.raises(ValidationError, match="Each backed-up camera"):
        DesktopBackupUpload.model_validate(_backup(cameras=[_camera_values(), _camera_values()]))


def test_backup_requires_the_base_revision() -> None:
    values = _backup()
    del values["baseRevision"]

    with pytest.raises(ValidationError, match="baseRevision"):
        DesktopBackupUpload.model_validate(values)


def test_backup_rejects_unknown_schema_versions() -> None:
    with pytest.raises(ValidationError):
        DesktopBackupUpload.model_validate({**_backup(), "schemaVersion": 2})


def _backup(**overrides: Any) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "deviceId": "desktop-1",
        "capturedAt": "2026-11-16T04:00:00Z",
        "baseRevision": None,
        "days": [_day("2026-11-15"), _day("2026-11-16")],
        "drafts": [_draft()],
        "submissions": [_submission()],
        "cameras": [_camera_values()],
        **overrides,
    }


def _day(business_date: str) -> dict[str, Any]:
    return {
        "businessDate": business_date,
        "finalized": business_date != "2026-11-16",
        "metrics": {"business_date": business_date, "entries": 12, "unique_count": 9},
    }


def _draft() -> dict[str, Any]:
    return {
        "draftKey": "period:November 2026",
        "period": "November 2026",
        "reportId": None,
        "payload": {"origins": {"2026-11-02": {"foreign": 3}}},
        "updatedAt": "2026-11-16T03:00:00Z",
    }


def _submission() -> dict[str, Any]:
    return {
        "reportId": "REP-OCT",
        "submissionId": "SUB-OCT",
        "period": "October 2026",
        "submittedAt": "2026-11-02T03:00:00Z",
        "entries": 120,
        "exits": 108,
        "peakOccupancy": 30,
        "uniqueCount": 90,
        "notes": None,
        "payload": {"status": "Submitted", "metrics": {"unique": 90}},
        "cameraBreakdown": [],
    }
