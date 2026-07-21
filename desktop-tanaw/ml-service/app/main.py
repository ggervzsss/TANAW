import asyncio
import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from time import monotonic
from typing import Any

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from app.camera.auth import redact_stream_credentials
from app.camera.camera_manager import CameraStreamUnavailableError
from app.camera.pipeline_manager import CameraCapacityError, CameraPipelineRegistry
from app.config.camera_config import (
    CameraProfilesRequest,
    CameraStartRequest,
    CameraStatesResponse,
    CameraTestRequest,
    CameraTestResponse,
    CountResponse,
    DetectionResponse,
    EnterpriseContextRequest,
    EnterpriseContextResponse,
    HealthResponse,
    MetricsHistoryResponse,
    MetricsSummaryResponse,
    OccupancyCorrectionRequest,
    OccupancyCorrectionResponse,
    ReportDraftRequest,
    ReportDraftResponse,
    ReportRawDataPurgeResponse,
    ReportSubmissionRecordResponse,
    ReportSubmissionRequest,
    ReportSubmissionResponse,
    SamplePrepareRequest,
    SamplePrepareResponse,
    SessionResponse,
    SyncMarkResponse,
)
from app.runtime.hardware import get_runtime_capabilities
from app.storage.local_data_store import LocalDatabaseResetRequiredError

CAMERA_WS_FRAME_INTERVAL_SECONDS = 0.20
CAMERA_WS_IDLE_INTERVAL_SECONDS = 1.00
CAMERA_WS_HEARTBEAT_INTERVAL_SECONDS = 15.00
SERVICE_VERSION = "0.2.0"
API_CONTRACT_VERSION = 2


class CameraApiError(RuntimeError):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


manager = CameraPipelineRegistry()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    yield
    await asyncio.to_thread(manager.stop_all)


app = FastAPI(title="TANAW Local ML Camera Service", version=SERVICE_VERSION, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "file://",
        "http://localhost",
        "http://127.0.0.1",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "null",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(LocalDatabaseResetRequiredError)
async def local_database_reset_required(
    _request: Request, exc: LocalDatabaseResetRequiredError
) -> JSONResponse:
    return JSONResponse(
        status_code=409,
        content={"code": "local_database_migration_required", "message": str(exc)},
    )


@app.exception_handler(CameraApiError)
async def camera_api_error(_request: Request, exc: CameraApiError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
    )


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse.model_validate(build_health_payload())


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
    ok, message = manager.test_connection(payload)
    return CameraTestResponse(ok=ok, message=message)


@app.post("/camera/start")
def start_camera(payload: CameraStartRequest) -> dict[str, Any]:
    try:
        started = manager.start(payload)
    except CameraCapacityError as exc:
        raise CameraApiError(429, "capacity_limit", str(exc)) from exc
    except CameraStreamUnavailableError as exc:
        raise CameraApiError(
            422, "stream_unavailable", redact_stream_credentials(str(exc))
        ) from exc
    except ValueError as exc:
        raise CameraApiError(
            400,
            "invalid_camera_configuration",
            redact_stream_credentials(str(exc)),
        ) from exc
    except Exception as exc:
        raise CameraApiError(
            500, "pipeline_start_failed", redact_stream_credentials(str(exc))
        ) from exc

    return {
        "message": "Camera processing started." if started else "Camera is already running.",
        "camera_id": payload.camera_id,
        "started": started,
    }


@app.post("/camera/{camera_id}/stop")
def stop_camera(camera_id: int) -> dict[str, Any]:
    stopped = manager.stop(camera_id)
    return {
        "message": "Camera processing stopped." if stopped else "Camera was not running.",
        "camera_id": camera_id,
        "stopped": stopped,
    }


@app.post("/cameras/stop")
def stop_all_cameras() -> dict[str, Any]:
    stopped = manager.stop_all()
    return {"message": "All camera processing stopped.", "stopped_count": stopped}


@app.get("/cameras", response_model=list[dict[str, Any]])
def list_cameras() -> list[dict[str, Any]]:
    return manager.list_camera_profiles()


@app.put("/cameras", response_model=list[dict[str, Any]])
def replace_cameras(payload: CameraProfilesRequest) -> list[dict[str, Any]]:
    try:
        return manager.replace_camera_profiles(payload.cameras)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/counts", response_model=CountResponse)
def counts() -> CountResponse:
    return CountResponse.model_validate(manager.aggregate_session()["counts"])


@app.get("/session", response_model=SessionResponse)
def session() -> SessionResponse:
    return SessionResponse(**manager.aggregate_session())


@app.get("/cameras/runtime", response_model=CameraStatesResponse)
def camera_states() -> CameraStatesResponse:
    return CameraStatesResponse.model_validate(manager.camera_states())


@app.get("/camera/{camera_id}/state")
def camera_state(camera_id: int) -> dict[str, Any]:
    try:
        return manager.camera_state(camera_id)
    except KeyError as exc:
        raise CameraApiError(
            404, "camera_not_found", "Camera pipeline has not been started."
        ) from exc


@app.get("/camera/{camera_id}/counts", response_model=CountResponse)
def camera_counts(camera_id: int) -> CountResponse:
    try:
        return CountResponse.model_validate(manager.require_pipeline(camera_id).counts())
    except KeyError as exc:
        raise CameraApiError(
            404, "camera_not_found", "Camera pipeline has not been started."
        ) from exc


@app.get("/camera/{camera_id}/session", response_model=SessionResponse)
def camera_session(camera_id: int) -> SessionResponse:
    try:
        return SessionResponse(**manager.require_pipeline(camera_id).session())
    except KeyError as exc:
        raise CameraApiError(
            404, "camera_not_found", "Camera pipeline has not been started."
        ) from exc


@app.get("/camera/{camera_id}/detections", response_model=DetectionResponse)
def camera_detections(camera_id: int) -> DetectionResponse:
    try:
        return DetectionResponse.model_validate(manager.require_pipeline(camera_id).detections())
    except KeyError as exc:
        raise CameraApiError(
            404, "camera_not_found", "Camera pipeline has not been started."
        ) from exc


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
            actor_id=payload.actor_id,
            actor_name=payload.actor_name,
            camera_id=payload.camera_id,
        )
    )


@app.get("/occupancy/corrections", response_model=list[OccupancyCorrectionResponse])
def occupancy_corrections(limit: int = 100) -> list[OccupancyCorrectionResponse]:
    return [
        OccupancyCorrectionResponse(**correction)
        for correction in manager.occupancy_corrections(limit=limit)
    ]


@app.post("/reports/local-submit", response_model=ReportSubmissionResponse)
def record_local_report_submission(payload: ReportSubmissionRequest) -> ReportSubmissionResponse:
    try:
        return ReportSubmissionResponse(
            **manager.record_report_submission(
                payload.report_id,
                payload.period,
                payload.notes,
                payload.payload,
                metrics=payload.metrics.model_dump() if payload.metrics else None,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.get("/reports/local", response_model=list[ReportSubmissionRecordResponse])
def list_local_report_submissions(limit: int = 100) -> list[ReportSubmissionRecordResponse]:
    return [
        ReportSubmissionRecordResponse(**submission)
        for submission in manager.list_report_submissions(limit=limit)
    ]


@app.get("/reports/drafts/{draft_key}", response_model=ReportDraftResponse | None)
def get_report_draft(draft_key: str) -> ReportDraftResponse | None:
    draft = manager.get_report_draft(draft_key)
    return ReportDraftResponse(**draft) if draft is not None else None


@app.put("/reports/drafts/{draft_key}", response_model=ReportDraftResponse)
def save_report_draft(draft_key: str, payload: ReportDraftRequest) -> ReportDraftResponse:
    return ReportDraftResponse(
        **manager.save_report_draft(
            draft_key=draft_key,
            period=payload.period,
            report_id=payload.report_id,
            payload=payload.payload,
        )
    )


@app.delete("/reports/drafts/{draft_key}", response_model=SyncMarkResponse)
def delete_report_draft(draft_key: str) -> SyncMarkResponse:
    return SyncMarkResponse(updated=1 if manager.delete_report_draft(draft_key) else 0)


@app.post("/reports/local/{report_id}/synced", response_model=SyncMarkResponse)
def mark_local_report_synced(report_id: str) -> SyncMarkResponse:
    return SyncMarkResponse(updated=1 if manager.mark_report_synced(report_id) else 0)


@app.post("/reports/local/{report_id}/purge-raw", response_model=ReportRawDataPurgeResponse)
def purge_local_report_raw_events(report_id: str) -> ReportRawDataPurgeResponse:
    return ReportRawDataPurgeResponse(**manager.purge_report_raw_events(report_id))


@app.post("/metrics/mark-synced", response_model=SyncMarkResponse)
def mark_local_events_synced() -> SyncMarkResponse:
    return SyncMarkResponse(updated=manager.mark_events_synced())


@app.post("/sample/prepare", response_model=SamplePrepareResponse)
def prepare_sample_counts(payload: SamplePrepareRequest) -> SamplePrepareResponse:
    try:
        return SamplePrepareResponse(
            **manager.prepare_sample_counts(
                report_id=payload.report_id,
                enterprise_id=payload.enterprise_id,
                enterprise_name=payload.enterprise_name,
                entries=payload.entries,
                exits=payload.exits,
                unique_count=payload.unique_count,
                peak_occupancy=payload.peak_occupancy,
                period=payload.period,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/session/restore", response_model=SessionResponse)
def restore_session() -> SessionResponse:
    return SessionResponse(**manager.aggregate_session())


@app.get("/detections", response_model=DetectionResponse)
def detections() -> DetectionResponse:
    states = manager.camera_states()["cameras"]
    if len(states) == 1:
        return DetectionResponse.model_validate(states[0]["detections"])
    return DetectionResponse(running=False, status="aggregate", tracks=[])


@app.websocket("/camera/ws")
async def camera_state_websocket(websocket: WebSocket) -> None:
    await websocket.accept()
    last_payload: str | None = None
    last_send_at = monotonic()

    try:
        while True:
            now = monotonic()
            envelope = await asyncio.to_thread(build_camera_state_envelope)
            payload = json.dumps(envelope, separators=(",", ":"), sort_keys=True)

            if payload != last_payload:
                await websocket.send_text(payload)
                last_payload = payload
                last_send_at = now
            elif now - last_send_at >= CAMERA_WS_HEARTBEAT_INTERVAL_SECONDS:
                await websocket.send_text('{"type":"heartbeat"}')
                last_send_at = now

            active_camera_count = envelope["data"]["active_camera_count"]
            interval = (
                CAMERA_WS_FRAME_INTERVAL_SECONDS
                if int(active_camera_count) > 0
                else CAMERA_WS_IDLE_INTERVAL_SECONDS
            )
            if not await wait_for_camera_websocket_client(websocket, interval):
                return
    except WebSocketDisconnect:
        return
    except RuntimeError:
        return


@app.get("/camera/{camera_id}/stream")
async def stream(camera_id: int, overlay: bool = True) -> StreamingResponse:
    try:
        pipeline = manager.require_pipeline(camera_id)
    except KeyError as exc:
        raise CameraApiError(
            404, "camera_not_found", "Camera pipeline has not been started."
        ) from exc

    async def frames():
        last_frame_id = 0
        while True:
            frame, last_frame_id = await asyncio.to_thread(
                pipeline.wait_for_stream_frame, last_frame_id, 1.0, overlay
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
    return HealthResponse.model_validate(
        {
            **manager.service_health(),
            "service_version": SERVICE_VERSION,
            "api_contract_version": API_CONTRACT_VERSION,
        }
    ).model_dump(mode="json")


def build_camera_state_envelope() -> dict[str, Any]:
    return {
        "type": "camera.states",
        "data": CameraStatesResponse.model_validate(manager.camera_states()).model_dump(
            mode="json"
        ),
    }
