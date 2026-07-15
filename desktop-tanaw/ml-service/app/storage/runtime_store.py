from datetime import UTC, datetime
from typing import Any

from app.storage.local_ledger import LocalLedger
from app.storage.session_credentials import scrub_session_snapshot


class EdgeRuntimeStore:
    def __init__(self, app_data_dir: str | None = None, enterprise_id: str | None = None) -> None:
        self._ledger = LocalLedger(app_data_dir, enterprise_id)

    def load_session(self) -> dict[str, Any] | None:
        payload = self._ledger.load_runtime_snapshot()
        if payload is None:
            return None
        scrubbed, _changed = scrub_session_snapshot(payload)
        return scrubbed

    def save_session(self, payload: dict[str, Any]) -> None:
        serializable = {
            **payload,
            "updated_at": datetime.now(UTC).isoformat(),
        }
        scrubbed, _changed = scrub_session_snapshot(serializable)
        self._ledger.save_runtime_snapshot(scrubbed, recorded_at=str(scrubbed["updated_at"]))

    def append_event(self, payload: dict[str, Any]) -> None:
        event = {
            **payload,
            "recorded_at": datetime.now(UTC).isoformat(),
        }
        self._ledger.append_count_event(event, event["recorded_at"])

    def start_monitoring_session(self, **values: Any) -> None:
        self._ledger.start_monitoring_session(**values)

    def mark_monitoring_connected(
        self, monitoring_session_id: str, connected_at: str | None = None
    ) -> None:
        self._ledger.mark_monitoring_connected(monitoring_session_id, connected_at)

    def record_coverage_gap(self, **values: Any) -> str:
        return self._ledger.record_coverage_gap(**values)

    def end_monitoring_session(self, monitoring_session_id: str, **values: Any) -> None:
        self._ledger.end_monitoring_session(monitoring_session_id, **values)

    def monitoring_coverage(self, period_id: str, *, as_of: str | None = None) -> dict[str, Any]:
        return self._ledger.monitoring_coverage(period_id, as_of=as_of)

    def record_persistence_error(self, **values: Any) -> str:
        return self._ledger.record_persistence_error(**values)

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
        self._ledger.upsert_visitor_identity(
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
        return self._ledger.append_visitor_sighting(payload, recorded_at)

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
        self._ledger.upsert_visitor_model_embedding(
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
        return self._ledger.load_active_visitor_identities(business_date, now)

    def load_active_visitor_model_embeddings(
        self,
        business_date: str,
        model_name: str,
        now: str | None = None,
    ) -> list[dict[str, Any]]:
        return self._ledger.load_active_visitor_model_embeddings(business_date, model_name, now)

    def cleanup_expired_visitor_metadata(self, now: str | None = None) -> int:
        return self._ledger.cleanup_expired_visitor_metadata(now)

    def metrics_summary(
        self,
        include_submitted: bool = False,
        period_id: str | None = None,
    ) -> dict[str, int | str | None]:
        return self._ledger.metrics_summary(
            include_submitted=include_submitted,
            period_id=period_id,
        )

    def metrics_history(
        self,
        include_submitted: bool = False,
        period_id: str | None = None,
    ) -> dict[str, Any]:
        return self._ledger.metrics_history(
            include_submitted=include_submitted,
            period_id=period_id,
        )

    def record_occupancy_correction(self, **values: Any) -> dict[str, Any]:
        return self._ledger.record_occupancy_correction(**values)

    def list_occupancy_corrections(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._ledger.list_occupancy_corrections(limit=limit)

    def create_local_report_revision(
        self,
        report_id: str,
        period_id: str,
        notes: str | None = None,
        payload: dict[str, Any] | None = None,
        metrics: dict[str, Any] | None = None,
        classification: str | None = None,
        simulation_run_id: str | None = None,
        *,
        idempotency_key: str | None = None,
        command_id: str | None = None,
    ) -> dict[str, int | str | None]:
        return self._ledger.create_local_report_revision(
            report_id=report_id,
            period_id=period_id,
            notes=notes,
            payload=payload,
            metrics=metrics,
            classification=classification,
            simulation_run_id=simulation_run_id,
            idempotency_key=idempotency_key,
            command_id=command_id,
        )

    def list_local_reports(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._ledger.list_local_reports(limit=limit)

    def list_ready_sync_outbox_items(
        self, limit: int = 100, now: str | None = None
    ) -> list[dict[str, Any]]:
        return self._ledger.list_ready_sync_outbox_items(limit=limit, now=now)

    def sync_outbox_health(self) -> dict[str, int | str | None]:
        return self._ledger.sync_outbox_health()

    def list_sync_outbox_recovery_items(self, limit: int = 100) -> list[dict[str, Any]]:
        return self._ledger.list_sync_outbox_recovery_items(limit=limit)

    def get_sync_outbox_recovery_item(self, outbox_item_id: str) -> dict[str, Any] | None:
        return self._ledger.get_sync_outbox_recovery_item(outbox_item_id)

    def requeue_sync_outbox_item(
        self,
        outbox_item_id: str,
        *,
        reason: str,
        requeued_at: str | None = None,
    ) -> dict[str, Any]:
        return self._ledger.requeue_sync_outbox_item(
            outbox_item_id,
            reason=reason,
            requeued_at=requeued_at,
        )

    def operational_diagnostics(self) -> dict[str, Any]:
        return self._ledger.operational_diagnostics()

    def acknowledge_sync_outbox_item(
        self,
        outbox_item_id: str,
        acknowledgement: dict[str, Any] | None = None,
        acknowledged_at: str | None = None,
    ) -> bool:
        return self._ledger.acknowledge_sync_outbox_item(
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
        return self._ledger.record_sync_outbox_failure(
            outbox_item_id,
            error_class=error_class,
            error_message=error_message,
            retryable=retryable,
            http_status=http_status,
            failed_at=failed_at,
        )

    def purge_report_raw_events(
        self,
        report_id: str,
        consolidated_revision_id: str,
    ) -> dict[str, int | str | None]:
        return self._ledger.purge_report_raw_events(report_id, consolidated_revision_id)

    def prepare_simulation_counts(self, **values: Any) -> dict[str, int | str | None]:
        return self._ledger.prepare_simulation_counts(**values)

    def remove_simulation_data(self, simulation_run_id: str | None = None) -> dict[str, int]:
        return self._ledger.remove_simulation_data(simulation_run_id)
