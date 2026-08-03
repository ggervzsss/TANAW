from typing import Any, NotRequired, TypedDict


class EnterpriseBinding(TypedDict):
    enterprise_id: str
    enterprise_name: str | None
    changed: bool
    session_restored: bool


class CameraCounts(TypedDict):
    entry: int
    exit: int
    occupancy: int
    running: bool
    status: str
    started_at: str | None
    error: str | None


class CameraSessionState(TypedDict):
    running: bool
    status: str
    error: str | None
    camera_id: int | None
    camera_name: str | None
    camera_config: dict[str, Any] | None
    counts: CameraCounts
    updated_at: str | None


class CountingConfigResult(TypedDict):
    camera_id: int
    persisted: bool
    worker_applied: bool
    session_id: int | None
    raw_frame_id: int | None
    stream_frame_id: int | None
    error: NotRequired[str]
