from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.features.monitoring.schemas import (
    MAX_TELEMETRY_CAMERA_ITEMS,
    MAX_TELEMETRY_SERIALIZED_BYTES,
    DesktopTelemetryIngest,
)


def test_telemetry_payload_accepts_current_camera_capacity() -> None:
    payload = _telemetry_payload(
        cameras=[_camera(index) for index in range(MAX_TELEMETRY_CAMERA_ITEMS)]
    )

    parsed = DesktopTelemetryIngest.model_validate(payload)

    assert len(parsed.monitoring.cameras) == MAX_TELEMETRY_CAMERA_ITEMS


def test_telemetry_payload_rejects_unbounded_camera_arrays() -> None:
    payload = _telemetry_payload(
        cameras=[_camera(index) for index in range(MAX_TELEMETRY_CAMERA_ITEMS + 1)]
    )

    with pytest.raises(ValidationError, match="List should have at most"):
        DesktopTelemetryIngest.model_validate(payload)


def test_telemetry_payload_rejects_oversized_arbitrary_data() -> None:
    payload = _telemetry_payload()
    payload["payload"] = {"diagnostic": "x" * MAX_TELEMETRY_SERIALIZED_BYTES}

    with pytest.raises(ValidationError, match="maximum serialized size"):
        DesktopTelemetryIngest.model_validate(payload)


def _telemetry_payload(*, cameras: list[dict[str, object]] | None = None) -> dict[str, object]:
    return {
        "deviceId": "desktop-1",
        "capturedAt": datetime(2026, 9, 1, 8, tzinfo=UTC),
        "metrics": {
            "entries": 12,
            "exits": 4,
            "peakOccupancy": 8,
            "currentOccupancy": 8,
            "uniqueCount": 10,
            "confirmedUniqueCount": 9,
            "degradedUniqueCount": 1,
            "totalEvents": 16,
            "unsubmittedEvents": 0,
            "unsyncedEvents": 0,
        },
        "session": {"running": True, "status": "running"},
        "health": {"modelReady": True},
        "monitoring": {
            "status": "running",
            "configuredCameraCount": len(cameras or []),
            "activeCameraCount": len(cameras or []),
            "healthyCameraCount": len(cameras or []),
            "cameras": cameras or [],
        },
        "payload": {"service": {"running": True}},
    }


def _camera(index: int) -> dict[str, object]:
    return {
        "cameraId": index,
        "cameraName": f"Camera {index}",
        "status": "running",
        "running": True,
    }
