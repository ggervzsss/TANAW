from typing import Any

from app.camera.auth import build_authenticated_stream_url, redact_stream_credentials
from app.camera.contracts import EnterpriseBinding
from app.camera.stream_reader import validate_stream
from app.config.camera_config import CameraTestRequest
from app.storage.session_store import SessionStore


class LocalOperationsService:
    """Owns enterprise persistence and stream probing without starting ML workers."""

    def __init__(self, app_data_dir: str | None = None) -> None:
        self._app_data_dir = app_data_dir
        self._enterprise_id: str | None = None
        self._enterprise_name: str | None = None
        self._store = SessionStore(app_data_dir)

    def bind_enterprise(
        self, enterprise_id: str, enterprise_name: str | None = None
    ) -> EnterpriseBinding:
        changed = self._enterprise_id != enterprise_id
        self._enterprise_id = enterprise_id
        self._enterprise_name = enterprise_name or self._enterprise_name
        if changed:
            self._store = SessionStore(self._app_data_dir, enterprise_id)
        return {
            "enterprise_id": enterprise_id,
            "enterprise_name": self._enterprise_name,
            "changed": changed,
            "session_restored": False,
        }

    def test_connection(self, payload: CameraTestRequest) -> tuple[bool, str]:
        stream_url = build_authenticated_stream_url(
            payload.stream_url, payload.username, payload.password
        )
        ok, message = validate_stream(stream_url)
        return ok, redact_stream_credentials(message)

    def list_camera_profiles(self) -> list[dict[str, Any]]:
        return self._store.list_camera_profiles()

    def replace_camera_profiles(self, cameras: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self._store.replace_camera_profiles(cameras)

    def metrics_summary(self, include_submitted: bool = False) -> dict[str, Any]:
        return self._store.metrics_summary(include_submitted=include_submitted)

    def metrics_history(self, include_submitted: bool = False) -> dict[str, Any]:
        return self._store.metrics_history(include_submitted=include_submitted)

    def record_occupancy_correction(self, **values: Any) -> dict[str, Any]:
        old_occupancy = self._store.enterprise_occupancy()
        return self._store.record_occupancy_correction(
            enterprise_id=self._enterprise_id,
            old_occupancy=old_occupancy,
            **values,
        )

    def occupancy_corrections(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._store.list_occupancy_corrections(limit=limit)

    def record_report_submission(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        return self._store.record_report_submission(*args, **kwargs)

    def list_report_submissions(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._store.list_report_submissions(limit=limit)

    def get_report_draft(self, draft_key: str) -> dict[str, Any] | None:
        return self._store.get_report_draft(draft_key)

    def save_report_draft(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        return self._store.save_report_draft(*args, **kwargs)

    def delete_report_draft(self, draft_key: str) -> bool:
        return self._store.delete_report_draft(draft_key)

    def mark_report_synced(self, report_id: str) -> bool:
        return self._store.mark_report_synced(report_id)

    def purge_report_raw_events(self, report_id: str) -> dict[str, Any]:
        return self._store.purge_report_raw_events(report_id)

    def mark_events_synced(self) -> int:
        return self._store.mark_events_synced()

    def prepare_sample_counts(self, **values: Any) -> dict[str, Any]:
        enterprise_id = values.pop("enterprise_id")
        enterprise_name = values.pop("enterprise_name")
        if self._enterprise_id != enterprise_id:
            raise ValueError(
                f"Desktop is bound to {self._enterprise_id or 'no enterprise'}. "
                f"Log into {enterprise_name or enterprise_id} before preparing counts."
            )
        summary = self._store.prepare_sample_counts(**values, camera_id=None, camera_name=None)
        return {
            **summary,
            "enterprise_id": enterprise_id,
            "enterprise_name": enterprise_name,
            "period": values["period"],
            "prepared": bool(summary.get("prepared")),
        }

    def close(self) -> None:
        return
