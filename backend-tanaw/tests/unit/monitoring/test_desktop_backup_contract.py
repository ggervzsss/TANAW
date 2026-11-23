from typing import Any

import pytest
from pydantic import ValidationError

from app.features.monitoring.schemas import (
    MAX_BACKUP_DAYS,
    MAX_BACKUP_SERIALIZED_BYTES,
    DesktopBackupUpload,
)


def _camera_values() -> dict[str, Any]:
    return {
        "id": 1,
        "name": "Main entrance",
        "zone": "Lobby",
        "status": "running",
        "cameraHost": "192.168.1.21",
        "rtsp": "rtsp://192.168.1.21/stream2",
        "processingProfile": "auto",
        "config": {"tripwire": 50},
    }


def test_backup_accepts_unsubmitted_days_drafts_and_cameras() -> None:
    parsed = DesktopBackupUpload.model_validate(_backup())

    assert [day.businessDate.isoformat() for day in parsed.days] == ["2026-11-15", "2026-11-16"]
    assert parsed.drafts[0].draftKey == "period:November 2026"
    assert parsed.cameras[0]["rtsp"] == "rtsp://192.168.1.21/stream2"


@pytest.mark.parametrize(
    "camera",
    [
        {**_camera_values(), "password": "secret"},
        {**_camera_values(), "username": "admin"},
        {**_camera_values(), "rtsp": "rtsp://admin:secret@192.168.1.21/stream2"},
        {**_camera_values(), "config": {"source": {"stream_url": "rtsp://admin@192.168.1.21/"}}},
    ],
)
def test_backup_rejects_camera_credentials(camera: dict[str, Any]) -> None:
    with pytest.raises(ValidationError, match="usernames or passwords"):
        DesktopBackupUpload.model_validate(_backup(cameras=[camera]))


def test_backup_allows_empty_credential_fields() -> None:
    camera = {**_camera_values(), "username": None, "password": ""}

    parsed = DesktopBackupUpload.model_validate(_backup(cameras=[camera]))

    assert parsed.cameras == [camera]


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


def test_backup_rejects_unknown_schema_versions() -> None:
    with pytest.raises(ValidationError):
        DesktopBackupUpload.model_validate({**_backup(), "schemaVersion": 2})


def _backup(**overrides: Any) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "deviceId": "desktop-1",
        "capturedAt": "2026-11-16T04:00:00Z",
        "days": [_day("2026-11-15"), _day("2026-11-16")],
        "drafts": [_draft()],
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
