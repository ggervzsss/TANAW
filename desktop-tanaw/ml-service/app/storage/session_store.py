import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.storage.local_metrics_store import LocalMetricsStore
from app.storage.session_credentials import scrub_session_snapshot


class SessionStore:
    def __init__(self, app_data_dir: str | None = None, enterprise_id: str | None = None) -> None:
        base_dir = app_data_dir or os.environ.get("TANAW_APP_DATA_DIR")
        if base_dir:
            root = Path(base_dir) / "ml-service"
        else:
            root = Path.home() / ".tanaw" / "ml-service"

        scope = _safe_scope(enterprise_id)
        self._root = root / "enterprises" / scope if enterprise_id else root

        self._session_path = self._root / "active_session.json"
        self._metrics_store = LocalMetricsStore(app_data_dir, enterprise_id)
        self._scrub_session_credentials()

    def load_session(self) -> dict[str, Any] | None:
        self._scrub_session_file()
        if not self._session_path.exists():
            return None

        try:
            with self._session_path.open("r", encoding="utf-8") as file:
                payload = json.load(file)
        except (OSError, json.JSONDecodeError):
            return None

        return payload if isinstance(payload, dict) else None

    def save_session(self, payload: dict[str, Any]) -> None:
        self._root.mkdir(parents=True, exist_ok=True)
        serializable = {
            **payload,
            "updated_at": datetime.now(UTC).isoformat(),
        }
        temporary_path = self._session_path.with_suffix(".tmp")

        with temporary_path.open("w", encoding="utf-8") as file:
            json.dump(serializable, file, indent=2, sort_keys=True)

        temporary_path.replace(self._session_path)
        self._metrics_store.save_camera_live_state(
            serializable,
            recorded_at=str(serializable["updated_at"]),
        )

    def append_event(self, payload: dict[str, Any]) -> None:
        event = {
            **payload,
            "recorded_at": datetime.now(UTC).isoformat(),
        }
        self._metrics_store.append_count_event(event, event["recorded_at"])

    def start_monitoring_session(self, **values: Any) -> None:
        self._metrics_store.start_monitoring_session(**values)

    def mark_monitoring_connected(
        self, monitoring_session_id: str, connected_at: str | None = None
    ) -> None:
        self._metrics_store.mark_monitoring_connected(monitoring_session_id, connected_at)

    def record_coverage_gap(self, **values: Any) -> str:
        return self._metrics_store.record_coverage_gap(**values)

    def end_monitoring_session(self, monitoring_session_id: str, **values: Any) -> None:
        self._metrics_store.end_monitoring_session(monitoring_session_id, **values)

    def monitoring_coverage(self, period_id: str, *, as_of: str | None = None) -> dict[str, Any]:
        return self._metrics_store.monitoring_coverage(period_id, as_of=as_of)

    def record_persistence_error(self, **values: Any) -> str:
        return self._metrics_store.record_persistence_error(**values)

    def upsert_visitor_identity(
        self,
        *,
        visitor_id: str,
        business_date: str,
        camera_id: int | None,
        embedding: bytes,
        embedding_dim: int,
        embedding_count: int,
        model_name: str,
        expires_at: str,
        recorded_at: str | None = None,
    ) -> None:
        self._metrics_store.upsert_visitor_identity(
            visitor_id=visitor_id,
            business_date=business_date,
            camera_id=camera_id,
            embedding=embedding,
            embedding_dim=embedding_dim,
            embedding_count=embedding_count,
            model_name=model_name,
            expires_at=expires_at,
            recorded_at=recorded_at,
        )

    def append_visitor_sighting(
        self, payload: dict[str, Any], recorded_at: str | None = None
    ) -> str:
        return self._metrics_store.append_visitor_sighting(payload, recorded_at)

    def upsert_visitor_model_embedding(
        self,
        *,
        visitor_id: str,
        model_name: str,
        embedding: bytes,
        embedding_dim: int,
        embedding_count: int,
        recorded_at: str | None = None,
    ) -> None:
        self._metrics_store.upsert_visitor_model_embedding(
            visitor_id=visitor_id,
            model_name=model_name,
            embedding=embedding,
            embedding_dim=embedding_dim,
            embedding_count=embedding_count,
            recorded_at=recorded_at,
        )

    def load_active_visitor_identities(
        self, business_date: str, now: str | None = None
    ) -> list[dict[str, Any]]:
        return self._metrics_store.load_active_visitor_identities(business_date, now)

    def load_active_visitor_model_embeddings(
        self,
        business_date: str,
        model_name: str,
        now: str | None = None,
    ) -> list[dict[str, Any]]:
        return self._metrics_store.load_active_visitor_model_embeddings(
            business_date, model_name, now
        )

    def cleanup_expired_visitor_metadata(self, now: str | None = None) -> int:
        return self._metrics_store.cleanup_expired_visitor_metadata(now)

    def metrics_summary(
        self,
        include_submitted: bool = False,
        period_id: str | None = None,
    ) -> dict[str, int | str | None]:
        return self._metrics_store.metrics_summary(
            include_submitted=include_submitted,
            period_id=period_id,
        )

    def metrics_history(
        self,
        include_submitted: bool = False,
        period_id: str | None = None,
    ) -> dict[str, Any]:
        return self._metrics_store.metrics_history(
            include_submitted=include_submitted,
            period_id=period_id,
        )

    def record_occupancy_correction(self, **values: Any) -> dict[str, Any]:
        return self._metrics_store.record_occupancy_correction(**values)

    def list_occupancy_corrections(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._metrics_store.list_occupancy_corrections(limit=limit)

    def create_local_report_revision(
        self,
        report_id: str,
        period_id: str,
        notes: str | None = None,
        payload: dict[str, Any] | None = None,
        metrics: dict[str, Any] | None = None,
        source_kind: str | None = None,
        mock_run_id: str | None = None,
        *,
        idempotency_key: str | None = None,
        command_id: str | None = None,
    ) -> dict[str, int | str | None]:
        return self._metrics_store.create_local_report_revision(
            report_id=report_id,
            period_id=period_id,
            notes=notes,
            payload=payload,
            metrics=metrics,
            source_kind=source_kind,
            mock_run_id=mock_run_id,
            idempotency_key=idempotency_key,
            command_id=command_id,
        )

    def list_local_reports(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._metrics_store.list_local_reports(limit=limit)

    def list_ready_sync_outbox_items(
        self, limit: int = 100, now: str | None = None
    ) -> list[dict[str, Any]]:
        return self._metrics_store.list_ready_sync_outbox_items(limit=limit, now=now)

    def sync_outbox_health(self) -> dict[str, int | str | None]:
        return self._metrics_store.sync_outbox_health()

    def acknowledge_sync_outbox_item(
        self,
        outbox_item_id: str,
        acknowledgement: dict[str, Any] | None = None,
        acknowledged_at: str | None = None,
    ) -> bool:
        return self._metrics_store.acknowledge_sync_outbox_item(
            outbox_item_id,
            acknowledgement=acknowledgement,
            acknowledged_at=acknowledged_at,
        )

    def record_sync_outbox_failure(
        self,
        outbox_item_id: str,
        *,
        error_class: str,
        error_message: str,
        retryable: bool,
        http_status: int | None = None,
        failed_at: str | None = None,
    ) -> dict[str, Any]:
        return self._metrics_store.record_sync_outbox_failure(
            outbox_item_id,
            error_class=error_class,
            error_message=error_message,
            retryable=retryable,
            http_status=http_status,
            failed_at=failed_at,
        )

    def purge_report_raw_events(self, report_id: str) -> dict[str, int | str | None]:
        return self._metrics_store.purge_report_raw_events(report_id)

    def prepare_mock_counts(self, **values: Any) -> dict[str, int | str | None]:
        return self._metrics_store.prepare_mock_counts(**values)

    def remove_mock_data(self, mock_run_id: str | None = None) -> dict[str, int]:
        return self._metrics_store.remove_mock_data(mock_run_id)

    def _scrub_session_credentials(self) -> None:
        self._scrub_session_file()

    def _scrub_session_file(self) -> None:
        if not self._session_path.exists():
            return
        try:
            payload = json.loads(self._session_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        if not isinstance(payload, dict):
            return
        scrubbed, changed = scrub_session_snapshot(payload)
        if not changed:
            return
        temporary_path = self._session_path.with_suffix(".tmp")
        try:
            with temporary_path.open("w", encoding="utf-8") as file:
                json.dump(scrubbed, file, indent=2, sort_keys=True)
            temporary_path.replace(self._session_path)
        except OSError:
            temporary_path.unlink(missing_ok=True)
            raise


def _safe_scope(value: str | None) -> str:
    if not value:
        return "unbound"
    normalized = "".join(
        character if character.isalnum() or character in "._-" else "_"
        for character in value.strip()
    )
    return normalized[:160] or "unbound"
