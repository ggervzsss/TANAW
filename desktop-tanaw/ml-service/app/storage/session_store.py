import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.storage.local_metrics_store import LocalMetricsStore


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

    def load_session(self) -> dict[str, Any] | None:
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
        self._metrics_store.save_count_snapshot(serializable, serializable["updated_at"])

    def append_event(self, payload: dict[str, Any]) -> None:
        event = {
            **payload,
            "recorded_at": datetime.now(UTC).isoformat(),
        }
        self._metrics_store.append_count_event(event, event["recorded_at"])

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

    def metrics_summary(self, include_submitted: bool = False) -> dict[str, int | str | None]:
        return self._metrics_store.metrics_summary(include_submitted=include_submitted)

    def metrics_history(self, include_submitted: bool = False) -> dict[str, Any]:
        return self._metrics_store.metrics_history(include_submitted=include_submitted)

    def record_occupancy_correction(self, **values: Any) -> dict[str, Any]:
        return self._metrics_store.record_occupancy_correction(**values)

    def list_occupancy_corrections(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._metrics_store.list_occupancy_corrections(limit=limit)

    def record_report_submission(
        self,
        report_id: str,
        period: str,
        notes: str | None = None,
        payload: dict[str, Any] | None = None,
        metrics: dict[str, Any] | None = None,
    ) -> dict[str, int | str | None]:
        return self._metrics_store.record_report_submission(
            report_id=report_id,
            period=period,
            notes=notes,
            payload=payload,
            metrics=metrics,
        )

    def list_report_submissions(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._metrics_store.list_report_submissions(limit=limit)

    def get_report_draft(self, draft_key: str) -> dict[str, Any] | None:
        return self._metrics_store.get_report_draft(draft_key)

    def save_report_draft(
        self,
        draft_key: str,
        period: str,
        payload: dict[str, Any],
        report_id: str | None = None,
    ) -> dict[str, Any]:
        return self._metrics_store.save_report_draft(
            draft_key=draft_key,
            period=period,
            payload=payload,
            report_id=report_id,
        )

    def delete_report_draft(self, draft_key: str) -> bool:
        return self._metrics_store.delete_report_draft(draft_key)

    def mark_report_synced(self, report_id: str) -> bool:
        return self._metrics_store.mark_report_synced(report_id)

    def purge_report_raw_events(self, report_id: str) -> dict[str, int | str | None]:
        return self._metrics_store.purge_report_raw_events(report_id)

    def mark_events_synced(self) -> int:
        return self._metrics_store.mark_events_synced()

    def prepare_sample_counts(self, **values: Any) -> dict[str, int | str | None]:
        return self._metrics_store.prepare_sample_counts(**values)


def _safe_scope(value: str | None) -> str:
    if not value:
        return "unbound"
    normalized = "".join(
        character if character.isalnum() or character in "._-" else "_"
        for character in value.strip()
    )
    return normalized[:160] or "unbound"
