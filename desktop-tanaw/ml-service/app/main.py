import asyncio
import json
import secrets
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from time import monotonic
from typing import Any

from fastapi import APIRouter, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

from app.api.dependencies import registry as _registry
from app.api.dependencies import settings as _settings
from app.api.errors import CameraApiError, camera_api_error, local_database_reset_required
from app.api.reporting import router as reporting_router
from app.camera.auth import redact_stream_credentials
from app.camera.contracts import CountingConfigResult
from app.camera.pipeline_manager import (
    CameraCapacityError,
    CameraConfigurationCapacityError,
    CameraNotActiveError,
    CameraPipelineRegistry,
    TripwirePersistenceError,
    TripwireWorkerUpdateError,
)
from app.config.camera_config import (
    CameraCountingConfigUpdate,
    CameraProfilesRequest,
    CameraStartRequest,
    CameraStatesResponse,
    CameraTestRequest,
    CameraTestResponse,
    EnterpriseContextRequest,
    EnterpriseContextResponse,
    HealthResponse,
    SessionResponse,
)
from app.config.report_config import (
    MetricsHistoryResponse,
    MetricsSummaryResponse,
)
from app.config.service_settings import ServiceSettings
from app.runtime.hardware import get_runtime_capabilities
from app.storage.local_data_schema import LocalDatabaseResetRequiredError

CAMERA_WS_FRAME_INTERVAL_SECONDS = 0.20
CAMERA_WS_IDLE_INTERVAL_SECONDS = 1.00
CAMERA_WS_HEARTBEAT_INTERVAL_SECONDS = 15.00
SERVICE_VERSION = "0.2.0"
API_CONTRACT_VERSION = 9


def has_valid_desktop_access_token(supplied_token: str, expected_token: str) -> bool:
    return not expected_token or secrets.compare_digest(supplied_token, expected_token)


router = APIRouter()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    yield
    await asyncio.to_thread(_registry(app).close)


def create_app(
    registry: CameraPipelineRegistry | None = None,
    settings: ServiceSettings | None = None,
) -> FastAPI:
    service_settings = settings or ServiceSettings.from_environment()
    application = FastAPI(
        title="TANAW Local ML Camera Service", version=SERVICE_VERSION, lifespan=lifespan
    )
    application.state.registry = registry or CameraPipelineRegistry()
    application.state.settings = service_settings
    application.add_middleware(
        CORSMiddleware,
        allow_origins=list(service_settings.allowed_origins),
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.middleware("http")
    async def require_desktop_access_token(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        expected_token = service_settings.access_token
        if request.method != "OPTIONS" and expected_token:
            supplied_token = request.headers.get("X-TANAW-ML-Token", "")
            if not has_valid_desktop_access_token(supplied_token, expected_token):
                return JSONResponse(
                    status_code=401,
                    content={
                        "code": "unauthorized",
                        "message": "A valid desktop service token is required.",
                    },
                )
        return await call_next(request)

    application.add_exception_handler(
        LocalDatabaseResetRequiredError, local_database_reset_required
    )
    application.add_exception_handler(CameraApiError, camera_api_error)
    application.include_router(router)
    application.include_router(reporting_router)
    return application


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    return HealthResponse.model_validate(build_health_payload(_registry(request)))


@router.get("/runtime/capabilities")
def runtime_capabilities() -> dict[str, object]:
    return get_runtime_capabilities()


@router.post("/context/enterprise", response_model=EnterpriseContextResponse)
def set_enterprise_context(
    payload: EnterpriseContextRequest, request: Request
) -> EnterpriseContextResponse:
    return EnterpriseContextResponse(
        **_registry(request).bind_enterprise(payload.enterprise_id, payload.enterprise_name)
    )


@router.post("/camera/test", response_model=CameraTestResponse)
def test_camera(payload: CameraTestRequest, request: Request) -> CameraTestResponse:
    ok, message = _registry(request).test_connection(payload)
    return CameraTestResponse(ok=ok, message=message)


@router.post("/camera/start", status_code=202)
def start_camera(payload: CameraStartRequest, request: Request) -> dict[str, Any]:
    try:
        accepted = _registry(request).request_start(payload)
    except CameraCapacityError as exc:
        raise CameraApiError(429, "capacity_limit", str(exc)) from exc
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
        "message": (
            "Camera startup accepted." if accepted else "Camera is already running or starting."
        ),
        "camera_id": payload.camera_id,
        "accepted": accepted,
    }


@router.post("/camera/{camera_id}/stop")
def stop_camera(camera_id: int, request: Request) -> dict[str, Any]:
    stopped = _registry(request).stop(camera_id)
    return {
        "message": "Camera processing stopped." if stopped else "Camera was not running.",
        "camera_id": camera_id,
        "stopped": stopped,
    }


@router.patch("/camera/{camera_id}/counting-config")
def update_camera_counting_config(
    camera_id: int, payload: CameraCountingConfigUpdate, request: Request
) -> CountingConfigResult:
    try:
        return _registry(request).update_counting_config(camera_id, payload)
    except KeyError as exc:
        raise CameraApiError(
            404, "camera_not_found", "The selected camera configuration was not found."
        ) from exc
    except CameraNotActiveError as exc:
        raise CameraApiError(409, "camera_not_active", redact_stream_credentials(str(exc))) from exc
    except TripwirePersistenceError as exc:
        raise CameraApiError(
            500, "tripwire_persistence_failed", redact_stream_credentials(str(exc))
        ) from exc
    except TripwireWorkerUpdateError as exc:
        raise CameraApiError(
            409, "tripwire_worker_update_failed", redact_stream_credentials(str(exc))
        ) from exc


@router.post("/cameras/stop")
def stop_all_cameras(request: Request) -> dict[str, Any]:
    stopped = _registry(request).stop_all()
    return {"message": "All camera processing stopped.", "stopped_count": stopped}


@router.get("/cameras", response_model=list[dict[str, Any]])
def list_cameras(request: Request) -> list[dict[str, Any]]:
    return _registry(request).list_camera_profiles()


@router.put("/cameras", response_model=list[dict[str, Any]])
def replace_cameras(payload: CameraProfilesRequest, request: Request) -> list[dict[str, Any]]:
    try:
        return _registry(request).replace_camera_profiles(payload.cameras)
    except CameraConfigurationCapacityError as exc:
        raise CameraApiError(409, "camera_configuration_limit", str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/session", response_model=SessionResponse)
def session(request: Request) -> SessionResponse:
    return SessionResponse(**_registry(request).aggregate_session())


@router.get("/cameras/runtime", response_model=CameraStatesResponse)
def camera_states(request: Request) -> CameraStatesResponse:
    return CameraStatesResponse.model_validate(_registry(request).camera_states())


@router.get("/metrics/summary", response_model=MetricsSummaryResponse)
def metrics_summary(request: Request, include_submitted: bool = False) -> MetricsSummaryResponse:
    return MetricsSummaryResponse(
        **_registry(request).metrics_summary(include_submitted=include_submitted)
    )


@router.get("/metrics/history", response_model=MetricsHistoryResponse)
def metrics_history(request: Request, include_submitted: bool = False) -> MetricsHistoryResponse:
    return MetricsHistoryResponse(
        **_registry(request).metrics_history(include_submitted=include_submitted)
    )


@router.websocket("/camera/ws")
async def camera_state_websocket(websocket: WebSocket) -> None:
    settings = _settings(websocket)
    if not has_valid_desktop_access_token(
        websocket.query_params.get("access_token", ""), settings.access_token
    ):
        await websocket.close(code=1008, reason="A valid desktop service token is required.")
        return
    await websocket.accept()
    last_payload: str | None = None
    last_send_at = monotonic()

    try:
        while True:
            now = monotonic()
            envelope = await asyncio.to_thread(build_camera_state_envelope, _registry(websocket))
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


@router.get("/camera/{camera_id}/stream")
async def stream(camera_id: int, request: Request, overlay: bool = True) -> StreamingResponse:
    try:
        pipeline = _registry(request).require_pipeline(camera_id)
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


def build_health_payload(registry: CameraPipelineRegistry) -> dict[str, Any]:
    return HealthResponse.model_validate(
        {
            **registry.service_health(),
            "service_version": SERVICE_VERSION,
            "api_contract_version": API_CONTRACT_VERSION,
            "tripwire_hot_update": True,
        }
    ).model_dump(mode="json")


def build_camera_state_envelope(registry: CameraPipelineRegistry) -> dict[str, Any]:
    return {
        "type": "camera.states",
        "data": CameraStatesResponse.model_validate(registry.camera_states()).model_dump(
            mode="json"
        ),
    }


app = create_app()
