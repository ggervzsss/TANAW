from datetime import UTC, datetime
from typing import Any

from app.storage.local_data_store import LocalDataStore


class SessionStore:
    def __init__(
        self,
        app_data_dir: str | None = None,
        enterprise_id: str | None = None,
        camera_id: int | None = None,
    ) -> None:
        self._camera_id = camera_id
        self._data_store = LocalDataStore(app_data_dir, enterprise_id)

    def load_session(self) -> dict[str, Any] | None:
        return self._data_store.load_monitoring_state(self._camera_id)

    def save_session(self, payload: dict[str, Any]) -> None:
        # Unit-level processing components may operate without a persisted camera
        # identity. Production pipelines always have a positive camera ID.
        if payload.get("camera_id") is None:
            return
        if self._camera_id is not None and payload.get("camera_id") != self._camera_id:
            raise ValueError("Camera monitoring state does not match its camera-scoped store.")
        updated_at = datetime.now(UTC).isoformat()
        self._data_store.save_monitoring_state(payload, updated_at)

    def list_camera_profiles(self) -> list[dict[str, Any]]:
        return self._data_store.list_camera_profiles()

    def replace_camera_profiles(self, cameras: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self._data_store.replace_camera_profiles(cameras)

    def append_event(self, payload: dict[str, Any]) -> None:
        event = {
            **payload,
            "recorded_at": datetime.now(UTC).isoformat(),
        }
        self._data_store.append_count_event(event, event["recorded_at"])

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
        identity_status: str = "confirmed",
        canonical_visitor_id: str | None = None,
        recorded_at: str | None = None,
    ) -> None:
        self._data_store.upsert_visitor_identity(
            visitor_id=visitor_id,
            business_date=business_date,
            camera_id=camera_id,
            embedding=embedding,
            embedding_dim=embedding_dim,
            embedding_count=embedding_count,
            model_name=model_name,
            expires_at=expires_at,
            identity_status=identity_status,
            canonical_visitor_id=canonical_visitor_id,
            recorded_at=recorded_at,
        )

    def upsert_visitor_identity_prototype(
        self,
        *,
        visitor_id: str,
        model_name: str,
        prototype_index: int,
        embedding: bytes,
        embedding_dim: int,
        embedding_count: int,
        recorded_at: str | None = None,
    ) -> None:
        self._data_store.upsert_visitor_identity_prototype(
            visitor_id=visitor_id,
            model_name=model_name,
            prototype_index=prototype_index,
            embedding=embedding,
            embedding_dim=embedding_dim,
            embedding_count=embedding_count,
            recorded_at=recorded_at,
        )

    def resolve_visitor_identity(
        self,
        visitor_id: str,
        *,
        identity_status: str,
        canonical_visitor_id: str | None = None,
        recorded_at: str | None = None,
    ) -> None:
        self._data_store.resolve_visitor_identity(
            visitor_id,
            identity_status=identity_status,
            canonical_visitor_id=canonical_visitor_id,
            recorded_at=recorded_at,
        )

    def restore_visitor_identity(
        self,
        visitor_id: str,
        *,
        recorded_at: str | None = None,
    ) -> bool:
        return self._data_store.restore_visitor_identity(
            visitor_id,
            recorded_at=recorded_at,
        )

    def append_visitor_sighting(
        self, payload: dict[str, Any], recorded_at: str | None = None
    ) -> str:
        return self._data_store.append_visitor_sighting(payload, recorded_at)

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
        self._data_store.upsert_visitor_model_embedding(
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
        return self._data_store.load_active_visitor_identities(business_date, now)

    def load_active_visitor_model_embeddings(
        self,
        business_date: str,
        model_name: str,
        now: str | None = None,
    ) -> list[dict[str, Any]]:
        return self._data_store.load_active_visitor_model_embeddings(business_date, model_name, now)

    def load_active_visitor_identity_prototypes(
        self,
        business_date: str,
        model_name: str,
        now: str | None = None,
    ) -> list[dict[str, Any]]:
        return self._data_store.load_active_visitor_identity_prototypes(
            business_date, model_name, now
        )

    def cleanup_expired_visitor_metadata(self, now: str | None = None) -> int:
        return self._data_store.cleanup_expired_visitor_metadata(now)

    def metrics_summary(self, include_submitted: bool = False) -> dict[str, int | str | None]:
        return self._data_store.metrics_summary(
            include_submitted=include_submitted, camera_id=self._camera_id
        )

    def enterprise_occupancy(self) -> int:
        return self._data_store.enterprise_occupancy()

    def metrics_history(self, include_submitted: bool = False) -> dict[str, Any]:
        return self._data_store.metrics_history(include_submitted=include_submitted)

    def record_occupancy_correction(self, **values: Any) -> dict[str, Any]:
        return self._data_store.record_occupancy_correction(**values)

    def list_occupancy_corrections(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._data_store.list_occupancy_corrections(limit=limit)

    def record_report_submission(
        self,
        report_id: str,
        period: str,
        notes: str | None = None,
        payload: dict[str, Any] | None = None,
        metrics: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return self._data_store.record_report_submission(
            report_id=report_id,
            period=period,
            notes=notes,
            payload=payload,
            metrics=metrics,
        )

    def list_report_submissions(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._data_store.list_report_submissions(limit=limit)

    def get_report_draft(self, draft_key: str) -> dict[str, Any] | None:
        return self._data_store.get_report_draft(draft_key)

    def save_report_draft(
        self,
        draft_key: str,
        period: str,
        payload: dict[str, Any],
        report_id: str | None = None,
    ) -> dict[str, Any]:
        return self._data_store.save_report_draft(
            draft_key=draft_key,
            period=period,
            payload=payload,
            report_id=report_id,
        )

    def delete_report_draft(self, draft_key: str) -> bool:
        return self._data_store.delete_report_draft(draft_key)

    def mark_report_synced(self, report_id: str) -> bool:
        return self._data_store.mark_report_synced(report_id)

    def purge_report_raw_events(self, report_id: str) -> dict[str, int | str | None]:
        return self._data_store.purge_report_raw_events(report_id)

    def mark_events_synced(self) -> int:
        return self._data_store.mark_events_synced()

    def prepare_sample_counts(self, **values: Any) -> dict[str, int | str | None]:
        return self._data_store.prepare_sample_counts(**values)
