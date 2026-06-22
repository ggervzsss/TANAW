import asyncio

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

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
    MetricsHistoryResponse,
    MetricsSummaryResponse,
    MockManualEventRequest,
    MockPrepareRequest,
    MockPrepareResponse,
    MockReportRequest,
    MockResetResponse,
    MockStartRequest,
    MockStatusResponse,
    ReportSubmissionRecordResponse,
    ReportSubmissionRequest,
    ReportSubmissionResponse,
    SessionResponse,
    SyncMarkResponse,
)

manager = CameraProcessingManager()

app = FastAPI(title="TANAW Local ML Camera Service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    counts = manager.counts()
    model_status = manager.model_status()
    return HealthResponse(
        running=bool(counts["running"]),
        error=counts["error"] if isinstance(counts["error"], str) else None,
        **model_status,
    )


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


@app.get("/session", response_model=SessionResponse)
def session() -> SessionResponse:
    return SessionResponse(**manager.session())


@app.get("/metrics/summary", response_model=MetricsSummaryResponse)
def metrics_summary(include_submitted: bool = False) -> MetricsSummaryResponse:
    return MetricsSummaryResponse(**manager.metrics_summary(include_submitted=include_submitted))


@app.get("/metrics/history", response_model=MetricsHistoryResponse)
def metrics_history(include_submitted: bool = False) -> MetricsHistoryResponse:
    return MetricsHistoryResponse(**manager.metrics_history(include_submitted=include_submitted))


@app.post("/reports/local-submit", response_model=ReportSubmissionResponse)
def record_local_report_submission(payload: ReportSubmissionRequest) -> ReportSubmissionResponse:
    try:
        return ReportSubmissionResponse(
            **manager.record_report_submission(
                payload.report_id, payload.period, payload.notes, payload.payload
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


@app.post("/reports/local/{report_id}/synced", response_model=SyncMarkResponse)
def mark_local_report_synced(report_id: str) -> SyncMarkResponse:
    return SyncMarkResponse(updated=1 if manager.mark_report_synced(report_id) else 0)


@app.post("/metrics/mark-synced", response_model=SyncMarkResponse)
def mark_local_events_synced() -> SyncMarkResponse:
    return SyncMarkResponse(updated=manager.mark_events_synced())


@app.post("/mock/prepare", response_model=MockPrepareResponse)
def prepare_mock_counts(payload: MockPrepareRequest) -> MockPrepareResponse:
    try:
        return MockPrepareResponse(
            **manager.prepare_mock_counts(
                mock_run_id=payload.mock_run_id,
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


@app.post("/mock/start", response_model=MockStatusResponse)
def start_mock_mode(payload: MockStartRequest) -> MockStatusResponse:
    try:
        return MockStatusResponse(
            **manager.start_mock_mode(
                mock_run_id=payload.mock_run_id,
                mode=payload.mode,
                scenario=payload.scenario,
                events_per_minute=payload.events_per_minute,
                capacity=payload.capacity,
                starting_occupancy=payload.starting_occupancy,
                duration_minutes=payload.duration_minutes,
                threshold_percent=payload.threshold_percent,
                entry_probability=payload.entry_probability,
                unique_entry_rate=payload.unique_entry_rate,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/mock/pause", response_model=MockStatusResponse)
def pause_mock_mode() -> MockStatusResponse:
    try:
        return MockStatusResponse(**manager.pause_mock_mode())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/mock/resume", response_model=MockStatusResponse)
def resume_mock_mode() -> MockStatusResponse:
    try:
        return MockStatusResponse(**manager.resume_mock_mode())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/mock/stop", response_model=MockStatusResponse)
def stop_mock_mode() -> MockStatusResponse:
    return MockStatusResponse(**manager.stop_mock_mode())


@app.post("/mock/event", response_model=MockStatusResponse)
def append_mock_event(payload: MockManualEventRequest) -> MockStatusResponse:
    try:
        return MockStatusResponse(**manager.append_mock_event(payload.direction))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/mock/reset", response_model=MockResetResponse)
def reset_mock_data(mock_run_id: str | None = None) -> MockResetResponse:
    removed = manager.reset_mock_data(mock_run_id)
    return MockResetResponse(stopped=True, removed=removed)


@app.get("/mock/status", response_model=MockStatusResponse)
def mock_status() -> MockStatusResponse:
    return MockStatusResponse(**manager.mock_status())


@app.post("/mock/generate-report", response_model=ReportSubmissionResponse)
def generate_mock_report(payload: MockReportRequest) -> ReportSubmissionResponse:
    try:
        return ReportSubmissionResponse(
            **manager.generate_mock_report(
                payload.report_id, payload.period, payload.notes, payload.payload
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/session/restore", response_model=SessionResponse)
def restore_session() -> SessionResponse:
    manager.restore_last_session()
    return SessionResponse(**manager.session())


@app.get("/detections", response_model=DetectionResponse)
def detections() -> DetectionResponse:
    return DetectionResponse.model_validate(manager.detections())


@app.get("/stream")
async def stream():
    async def frames():
        last_frame_id = 0
        while True:
            frame, last_frame_id = await asyncio.to_thread(
                manager.wait_for_stream_frame, last_frame_id
            )
            yield (
                b"--frame\r\nContent-Type: image/jpeg\r\nCache-Control: no-cache\r\n\r\n"
                + frame
                + b"\r\n"
            )

    return StreamingResponse(frames(), media_type="multipart/x-mixed-replace; boundary=frame")
