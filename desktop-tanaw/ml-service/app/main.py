from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime
from time import monotonic
from typing import Any, Literal
from uuid import UUID

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.camera.auth import redact_stream_credentials
from app.camera.camera_manager import CameraProcessingManager
from app.config.camera_config import (
    CameraStartRequest,
    CameraTestRequest,
    CameraTestResponse,
    CountResponse,
    DetectionResponse,
    EnterpriseContextRequest,
    EnterpriseContextResponse,
    HealthResponse,
    LocalReportRecordResponse,
    LocalReportRevisionRequest,
    LocalReportRevisionResponse,
    MetricsHistoryResponse,
    MetricsSummaryResponse,
    OccupancyCorrectionRequest,
    OccupancyCorrectionResponse,
    ReportRawDataPurgeRequest,
    ReportRawDataPurgeResponse,
    SessionResponse,
    SimulationPrepareRequest,
    SimulationPrepareResponse,
    SimulationResetResponse,
    SimulationStatusResponse,
)
from app.runtime.hardware import get_runtime_capabilities
from app.security.local_capability import (
    LOCAL_CONTRACT_VERSION,
    LOCAL_RELEASE_ID,
    LOCAL_SERVICE_NAME,
    LOCAL_SERVICE_VERSION,
    LocalCapabilityMiddleware,
    SessionMintRequest,
    SessionMintResponse,
    get_authenticated_session,
    get_authority,
)

CAMERA_WS_FRAME_INTERVAL_SECONDS = 0.20
CAMERA_WS_IDLE_INTERVAL_SECONDS = 1.00
CAMERA_WS_HEALTH_INTERVAL_SECONDS = 2.00
CAMERA_WS_HEARTBEAT_INTERVAL_SECONDS = 15.00

manager = CameraProcessingManager()


class SyncOutboxAcknowledgementRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    acknowledgement: dict[str, Any]

    @model_validator(mode="after")
    def validate_acknowledgement(self) -> SyncOutboxAcknowledgementRequest:
        acknowledgement = self.acknowledgement
        if set(acknowledgement) != {
            "contractVersion",
            "commandId",
            "disposition",
            "payloadHash",
            "acknowledgedAt",
            "resource",
        }:
            raise ValueError("The exact report acknowledgement contract is required.")
        if acknowledgement.get("contractVersion") != 2:
            raise ValueError("A version 2 acknowledgement is required.")
        command_id = acknowledgement.get("commandId")
        payload_hash = acknowledgement.get("payloadHash")
        acknowledged_at = acknowledgement.get("acknowledgedAt")
        resource = acknowledgement.get("resource")
        try:
            UUID(str(command_id))
        except ValueError as exc:
            raise ValueError("The exact acknowledgement command ID is required.") from exc
        if acknowledgement.get("disposition") not in {"created", "replayed"}:
            raise ValueError("The acknowledgement disposition is invalid.")
        if (
            not isinstance(payload_hash, str)
            or re.fullmatch(r"sha256:[0-9a-f]{64}", payload_hash) is None
        ):
            raise ValueError("The exact acknowledgement payload hash is required.")
        if not isinstance(acknowledged_at, str):
            raise ValueError("The acknowledgement timestamp is required.")
        try:
            parsed_acknowledged_at = datetime.fromisoformat(acknowledged_at.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError("The acknowledgement timestamp is invalid.") from exc
        if parsed_acknowledged_at.tzinfo is None:
            raise ValueError("The acknowledgement timestamp must include a timezone.")
        if not isinstance(resource, dict) or set(resource) != {
            "periodKey",
            "reportingPeriodId",
            "enterpriseReportId",
            "reportRevisionId",
            "revisionNumber",
            "workflowState",
            "logicalVersion",
        }:
            raise ValueError("The exact report acknowledgement resource is required.")
        if (
            not isinstance(resource.get("periodKey"), str)
            or re.fullmatch(r"month:Asia/Manila:\d{4}-(?:0[1-9]|1[0-2])", resource["periodKey"])
            is None
        ):
            raise ValueError("The acknowledgement reporting period is invalid.")
        try:
            for key in ("reportingPeriodId", "enterpriseReportId", "reportRevisionId"):
                UUID(str(resource.get(key)))
        except ValueError as exc:
            raise ValueError("The acknowledgement resource IDs are invalid.") from exc
        if (
            not isinstance(resource.get("revisionNumber"), int)
            or resource["revisionNumber"] < 1
            or resource.get("workflowState") != "submitted"
            or not isinstance(resource.get("logicalVersion"), int)
            or resource["logicalVersion"] < 1
        ):
            raise ValueError("The acknowledgement resource version is invalid.")
        return self


class SyncOutboxFailureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error_class: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9_.-]+$")
    error_message: str = Field(min_length=1, max_length=500)
    retryable: bool
    http_status: int | None = Field(default=None, ge=100, le=599)


class SyncOutboxRecoveryItemResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    outbox_item_id: UUID
    report_id: str = Field(min_length=1, max_length=240)
    report_revision_id: UUID
    revision_number: int = Field(ge=1)
    command_id: UUID
    endpoint: Literal["/operational/desktop/report-submissions/v2"]
    contract_version: Literal[2]
    status: Literal["ready", "retry", "dead_letter"]
    created_at: datetime
    next_attempt_at: datetime
    attempt_count: int = Field(ge=1)
    last_attempt_at: datetime | None
    last_error_class: str | None = Field(default=None, min_length=1, max_length=120)
    last_error_message: str | None = Field(default=None, min_length=1, max_length=500)


class SyncOutboxManualRetryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=3, max_length=500)


class SyncOutboxHealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pending_count: int = Field(ge=0)
    retry_item_count: int = Field(ge=0)
    dead_letter_count: int = Field(ge=0)
    attempt_count: int = Field(ge=0)
    oldest_pending_at: datetime | None
    last_acknowledged_at: datetime | None
    last_failure_at: datetime | None
    last_failure_class: str | None = Field(default=None, min_length=1, max_length=120)

    @model_validator(mode="after")
    def validate_health(self) -> SyncOutboxHealthResponse:
        for timestamp in (
            self.oldest_pending_at,
            self.last_acknowledged_at,
            self.last_failure_at,
        ):
            if timestamp is not None and timestamp.utcoffset() is None:
                raise ValueError("Sync outbox health timestamps must include a timezone.")
        if (self.pending_count == 0) != (self.oldest_pending_at is None):
            raise ValueError("The oldest pending timestamp must match the durable backlog.")
        if (
            self.retry_item_count > self.pending_count
            or self.dead_letter_count > self.pending_count
        ):
            raise ValueError("Retry and dead-letter items must be part of the durable backlog.")
        if self.attempt_count < self.retry_item_count + self.dead_letter_count:
            raise ValueError("The durable attempt count cannot be lower than failed item counts.")
        if (self.last_failure_at is None) != (self.last_failure_class is None):
            raise ValueError("The last failure timestamp and class must be supplied together.")
        return self


class LedgerWriterDiagnosticsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    connection_open_count: int = Field(ge=0)
    transaction_attempt_count: int = Field(ge=0)
    committed_transaction_count: int = Field(ge=0)
    rolled_back_transaction_count: int = Field(ge=0)
    active_writer_count: int = Field(ge=0)
    maximum_concurrent_writers: int = Field(ge=0)
    lock_wait_observations: int = Field(ge=0)
    latest_lock_wait_ms: float = Field(ge=0)
    maximum_lock_wait_ms: float = Field(ge=0)
    transaction_duration_observations: int = Field(ge=0)
    latest_transaction_duration_ms: float = Field(ge=0)
    maximum_transaction_duration_ms: float = Field(ge=0)


class LocalPersistenceDiagnosticsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    error_count: int = Field(ge=0)
    unresolved_count: int = Field(ge=0)
    last_error_at: datetime | None


class CameraReliabilityDiagnosticsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reconnect_attempts: int = Field(ge=0)
    active_sessions: int = Field(ge=0)
    coverage_evidence_status: Literal["recorded", "not_recorded"]
    monitored_seconds: float | None = Field(default=None, ge=0)
    expected_seconds: float | None = Field(default=None, ge=0)
    coverage_ratio: float | None = Field(default=None, ge=0, le=1)
    gap_count: int | None = Field(default=None, ge=0)


class LocalOperationalDiagnosticsResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    observed_at: datetime
    reporting_period_id: str = Field(pattern=r"^month:Asia/Manila:\d{4}-(0[1-9]|1[0-2])$")
    outbox: SyncOutboxHealthResponse
    writer: LedgerWriterDiagnosticsResponse
    persistence: LocalPersistenceDiagnosticsResponse
    camera: CameraReliabilityDiagnosticsResponse


app = FastAPI(
    title="TANAW Local ML Camera Service",
    version=LOCAL_SERVICE_VERSION,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
app.add_middleware(LocalCapabilityMiddleware)


@app.get("/health")
def health(request: Request) -> dict[str, object]:
    authority = get_authority(request)
    challenge = request.headers.get("x-tanaw-health-challenge")
    if authority is None or not challenge or len(challenge) > 256:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return {
        "serviceName": LOCAL_SERVICE_NAME,
        "localContractVersion": LOCAL_CONTRACT_VERSION,
        "releaseId": LOCAL_RELEASE_ID,
        "launchId": authority.launch_id,
        "pid": os.getpid(),
        "status": "ready",
        "challengeResponse": authority.health_challenge_response(challenge),
    }


@app.get("/camera/health", response_model=HealthResponse)
def camera_health() -> HealthResponse:
    return HealthResponse.model_validate(build_health_payload())


@app.post("/auth/session", response_model=SessionMintResponse)
def mint_session(payload: SessionMintRequest, request: Request) -> SessionMintResponse:
    authority = get_authority(request)
    if authority is None:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return authority.mint_session(payload.scope, payload.ttl_seconds)


@app.get("/runtime/capabilities")
def runtime_capabilities() -> dict[str, object]:
    return get_runtime_capabilities()


@app.post("/context/enterprise", response_model=EnterpriseContextResponse)
def set_enterprise_context(payload: EnterpriseContextRequest) -> EnterpriseContextResponse:
    return EnterpriseContextResponse(
        **manager.bind_enterprise(payload.enterprise_id, payload.enterprise_name)
    )


@app.post("/camera/test", response_model=CameraTestResponse)
def test_camera(payload: CameraTestRequest) -> CameraTestResponse:
    ok, message = manager.test_connection(
        payload.stream_url, payload.camera_type, payload.username, payload.password
    )
    return CameraTestResponse(ok=ok, message=message)


@app.post("/camera/start")
def start_camera(payload: CameraStartRequest) -> dict[str, str]:
    try:
        manager.start(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=redact_stream_credentials(str(exc))) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=redact_stream_credentials(str(exc))) from exc

    return {"message": "Camera processing started."}


@app.post("/camera/stop")
def stop_camera() -> dict[str, str]:
    manager.stop()
    return {"message": "Camera processing stopped."}


@app.get("/counts", response_model=CountResponse)
def counts() -> CountResponse:
    return CountResponse.model_validate(manager.counts())


@app.get(
    "/session",
    response_model=SessionResponse,
    response_model_exclude={"camera_config"},
)
def session() -> SessionResponse:
    return SessionResponse(**manager.session())


@app.get("/metrics/summary", response_model=MetricsSummaryResponse)
def metrics_summary(include_submitted: bool = False) -> MetricsSummaryResponse:
    return MetricsSummaryResponse(**manager.metrics_summary(include_submitted=include_submitted))


@app.get("/metrics/history", response_model=MetricsHistoryResponse)
def metrics_history(include_submitted: bool = False) -> MetricsHistoryResponse:
    return MetricsHistoryResponse(**manager.metrics_history(include_submitted=include_submitted))


@app.post("/occupancy/correction", response_model=OccupancyCorrectionResponse)
def record_occupancy_correction(
    payload: OccupancyCorrectionRequest,
) -> OccupancyCorrectionResponse:
    return OccupancyCorrectionResponse(
        **manager.record_occupancy_correction(
            new_occupancy=payload.new_occupancy,
            reason=payload.reason,
            camera_id=payload.camera_id,
        )
    )


@app.get("/occupancy/corrections", response_model=list[OccupancyCorrectionResponse])
def occupancy_corrections(limit: int = 100) -> list[OccupancyCorrectionResponse]:
    return [
        OccupancyCorrectionResponse(**correction)
        for correction in manager.occupancy_corrections(limit=limit)
    ]


@app.post("/reports/local", response_model=LocalReportRevisionResponse)
def create_local_report_revision(
    payload: LocalReportRevisionRequest,
) -> LocalReportRevisionResponse:
    try:
        return LocalReportRevisionResponse(
            **manager.create_local_report_revision(
                payload.report_id,
                payload.period_id,
                payload.notes,
                payload.payload,
                metrics=payload.metrics.model_dump() if payload.metrics else None,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/reports/local", response_model=list[LocalReportRecordResponse])
def list_local_reports(limit: int = 100) -> list[LocalReportRecordResponse]:
    return [
        LocalReportRecordResponse(**submission)
        for submission in manager.list_local_reports(limit=limit)
    ]


@app.get("/sync/outbox/ready")
def list_ready_sync_outbox_items(
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict[str, Any]]:
    return manager.list_ready_sync_outbox_items(limit=limit)


@app.get("/sync/outbox/health", response_model=SyncOutboxHealthResponse)
def get_sync_outbox_health() -> SyncOutboxHealthResponse:
    return SyncOutboxHealthResponse.model_validate(manager.sync_outbox_health())


@app.get(
    "/sync/outbox/recovery",
    response_model=list[SyncOutboxRecoveryItemResponse],
)
def list_sync_outbox_recovery_items(
    limit: int = Query(default=100, ge=1, le=500),
) -> list[SyncOutboxRecoveryItemResponse]:
    return [
        SyncOutboxRecoveryItemResponse.model_validate(item)
        for item in manager.list_sync_outbox_recovery_items(limit=limit)
    ]


@app.get(
    "/sync/outbox/{outbox_item_id}/recovery",
    response_model=SyncOutboxRecoveryItemResponse,
)
def get_sync_outbox_recovery_item(outbox_item_id: UUID) -> SyncOutboxRecoveryItemResponse:
    item = manager.get_sync_outbox_recovery_item(str(outbox_item_id))
    if item is None:
        raise HTTPException(status_code=404, detail="Unknown official sync outbox item.")
    return SyncOutboxRecoveryItemResponse.model_validate(item)


@app.post(
    "/sync/outbox/{outbox_item_id}/retry",
    response_model=SyncOutboxRecoveryItemResponse,
)
def retry_sync_outbox_item(
    outbox_item_id: UUID,
    payload: SyncOutboxManualRetryRequest,
) -> SyncOutboxRecoveryItemResponse:
    try:
        item = manager.requeue_sync_outbox_item(
            str(outbox_item_id),
            reason=payload.reason,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return SyncOutboxRecoveryItemResponse.model_validate(item)


@app.get("/diagnostics/operations", response_model=LocalOperationalDiagnosticsResponse)
def get_operational_diagnostics() -> LocalOperationalDiagnosticsResponse:
    return LocalOperationalDiagnosticsResponse.model_validate(manager.operational_diagnostics())


@app.post("/sync/outbox/{outbox_item_id}/acknowledge")
def acknowledge_sync_outbox_item(
    outbox_item_id: str,
    payload: SyncOutboxAcknowledgementRequest,
) -> dict[str, object]:
    acknowledged_at = str(payload.acknowledgement["acknowledgedAt"])
    try:
        acknowledged = manager.acknowledge_sync_outbox_item(
            outbox_item_id,
            acknowledgement=payload.acknowledgement,
            acknowledged_at=acknowledged_at,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not acknowledged:
        raise HTTPException(status_code=404, detail="Unknown sync outbox item.")
    return {"acknowledged": True, "outbox_item_id": outbox_item_id}


@app.post("/sync/outbox/{outbox_item_id}/failure")
def record_sync_outbox_failure(
    outbox_item_id: str,
    payload: SyncOutboxFailureRequest,
) -> dict[str, Any]:
    try:
        return manager.record_sync_outbox_failure(
            outbox_item_id,
            error_class=payload.error_class,
            error_message=payload.error_message,
            retryable=payload.retryable,
            http_status=payload.http_status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/reports/local/{report_id}/purge-raw", response_model=ReportRawDataPurgeResponse)
def purge_local_report_raw_events(
    report_id: str,
    payload: ReportRawDataPurgeRequest,
) -> ReportRawDataPurgeResponse:
    try:
        result = manager.purge_report_raw_events(
            report_id,
            str(payload.consolidated_revision_id),
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return ReportRawDataPurgeResponse(**result)


@app.post("/simulations/prepare", response_model=SimulationPrepareResponse)
def prepare_simulation_counts(payload: SimulationPrepareRequest) -> SimulationPrepareResponse:
    try:
        return SimulationPrepareResponse(
            **manager.prepare_simulation_counts(
                simulation_run_id=payload.simulation_run_id,
                enterprise_id=payload.enterprise_id,
                enterprise_name=payload.enterprise_name,
                entries=payload.entries,
                exits=payload.exits,
                unique_count=payload.unique_count,
                peak_occupancy=payload.peak_occupancy,
                period_id=payload.period_id,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/simulations/reset", response_model=SimulationResetResponse)
def reset_simulation_data(simulation_run_id: str | None = None) -> SimulationResetResponse:
    removed = manager.reset_simulation_data(simulation_run_id)
    return SimulationResetResponse(stopped=True, removed=removed)


@app.get("/simulations/status", response_model=SimulationStatusResponse)
def simulation_status() -> SimulationStatusResponse:
    return SimulationStatusResponse(**manager.simulation_status())


@app.post(
    "/session/restore",
    response_model=SessionResponse,
    response_model_exclude={"camera_config"},
)
def restore_session() -> SessionResponse:
    manager.restore_last_session()
    return SessionResponse(**manager.session())


@app.get("/detections", response_model=DetectionResponse)
def detections() -> DetectionResponse:
    return DetectionResponse.model_validate(manager.detections())


@app.websocket("/camera/ws")
async def camera_state_websocket(websocket: WebSocket) -> None:
    authority = get_authority(app)
    if authority is None:
        await websocket.close(code=4401)
        return
    authenticated, accepted_protocol = authority.authenticate_websocket(
        websocket,
        "camera-events",
    )
    if authenticated is None:
        await websocket.close(code=4401)
        return
    if not authority.allow_request("camera-events", 30, 10.0):
        await websocket.close(code=4429)
        return
    await websocket.accept(subprotocol=accepted_protocol)
    last_payload: str | None = None
    last_send_at = monotonic()
    last_health_at = 0.0
    health_payload: dict[str, Any] | None = None

    try:
        while True:
            if not authority.session_is_active(authenticated):
                await websocket.close(code=4401)
                return
            now = monotonic()
            if health_payload is None or now - last_health_at >= CAMERA_WS_HEALTH_INTERVAL_SECONDS:
                health_payload = await asyncio.to_thread(build_health_payload)
                last_health_at = now

            envelope = await asyncio.to_thread(build_camera_state_envelope, health_payload)
            payload = json.dumps(envelope, separators=(",", ":"), sort_keys=True)

            if payload != last_payload:
                await websocket.send_text(payload)
                last_payload = payload
                last_send_at = now
            elif now - last_send_at >= CAMERA_WS_HEARTBEAT_INTERVAL_SECONDS:
                await websocket.send_text('{"type":"heartbeat"}')
                last_send_at = now

            counts_payload = envelope["data"]["counts"]
            interval = (
                CAMERA_WS_FRAME_INTERVAL_SECONDS
                if bool(counts_payload.get("running"))
                else CAMERA_WS_IDLE_INTERVAL_SECONDS
            )
            if not await wait_for_camera_websocket_client(websocket, interval):
                return
    except WebSocketDisconnect:
        return
    except RuntimeError:
        return


@app.get("/stream")
async def stream(request: Request, overlay: bool = True) -> StreamingResponse:
    authority = get_authority(request)
    authenticated = get_authenticated_session(request)
    if authority is None or authenticated is None:
        raise HTTPException(status_code=401, detail="Unauthorized")

    async def frames():
        last_frame_id = 0
        while authority.session_is_active(authenticated):
            frame, last_frame_id = await asyncio.to_thread(
                manager.wait_for_stream_frame, last_frame_id, 1.0, overlay
            )
            yield (
                b"--frame\r\nContent-Type: image/jpeg\r\nCache-Control: no-cache\r\n\r\n"
                + frame
                + b"\r\n"
            )

    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame")


async def wait_for_camera_websocket_client(websocket: WebSocket, timeout_seconds: float) -> bool:
    try:
        await asyncio.wait_for(websocket.receive_text(), timeout=timeout_seconds)
    except TimeoutError:
        return True
    except WebSocketDisconnect:
        return False
    except RuntimeError:
        return False

    return True


def build_health_payload() -> dict[str, Any]:
    counts = manager.counts()
    return HealthResponse(
        running=bool(counts["running"]),
        error=counts["error"] if isinstance(counts["error"], str) else None,
        **manager.model_status(),
    ).model_dump(mode="json")


def build_camera_state_envelope(health_payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "camera.state",
        "data": {
            "counts": CountResponse.model_validate(manager.counts()).model_dump(mode="json"),
            "detections": DetectionResponse.model_validate(manager.detections()).model_dump(
                mode="json"
            ),
            "health": health_payload,
            "session": SessionResponse(**manager.session()).model_dump(
                mode="json",
                exclude={"camera_config"},
            ),
        },
    }
