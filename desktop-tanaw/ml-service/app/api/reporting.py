from fastapi import APIRouter, HTTPException, Request

from app.api.dependencies import registry
from app.config.report_config import (
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
    SyncMarkResponse,
)

router = APIRouter(tags=["reporting"])


@router.post("/occupancy/correction", response_model=OccupancyCorrectionResponse)
def record_occupancy_correction(
    payload: OccupancyCorrectionRequest, request: Request
) -> OccupancyCorrectionResponse:
    return OccupancyCorrectionResponse(
        **registry(request).record_occupancy_correction(
            new_occupancy=payload.new_occupancy,
            reason=payload.reason,
            actor_id=payload.actor_id,
            actor_name=payload.actor_name,
            camera_id=payload.camera_id,
        )
    )


@router.get("/occupancy/corrections", response_model=list[OccupancyCorrectionResponse])
def occupancy_corrections(request: Request, limit: int = 100) -> list[OccupancyCorrectionResponse]:
    return [
        OccupancyCorrectionResponse(**correction)
        for correction in registry(request).occupancy_corrections(limit=limit)
    ]


@router.post("/reports/local-submit", response_model=ReportSubmissionResponse)
def record_local_report_submission(
    payload: ReportSubmissionRequest, request: Request
) -> ReportSubmissionResponse:
    try:
        return ReportSubmissionResponse(
            **registry(request).record_report_submission(
                payload.report_id,
                payload.period,
                payload.notes,
                payload.payload,
                metrics=payload.metrics.model_dump() if payload.metrics else None,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.get("/reports/local", response_model=list[ReportSubmissionRecordResponse])
def list_local_report_submissions(
    request: Request, limit: int = 100
) -> list[ReportSubmissionRecordResponse]:
    return [
        ReportSubmissionRecordResponse(**submission)
        for submission in registry(request).list_report_submissions(limit=limit)
    ]


@router.get("/reports/drafts/{draft_key}", response_model=ReportDraftResponse | None)
def get_report_draft(draft_key: str, request: Request) -> ReportDraftResponse | None:
    draft = registry(request).get_report_draft(draft_key)
    return ReportDraftResponse(**draft) if draft is not None else None


@router.put("/reports/drafts/{draft_key}", response_model=ReportDraftResponse)
def save_report_draft(
    draft_key: str, payload: ReportDraftRequest, request: Request
) -> ReportDraftResponse:
    return ReportDraftResponse(
        **registry(request).save_report_draft(
            draft_key=draft_key,
            period=payload.period,
            report_id=payload.report_id,
            payload=payload.payload,
        )
    )


@router.delete("/reports/drafts/{draft_key}", response_model=SyncMarkResponse)
def delete_report_draft(draft_key: str, request: Request) -> SyncMarkResponse:
    return SyncMarkResponse(updated=1 if registry(request).delete_report_draft(draft_key) else 0)


@router.post(
    "/reports/local/{report_id}/submissions/{submission_id}/synced",
    response_model=SyncMarkResponse,
)
def mark_local_report_synced(
    report_id: str, submission_id: str, request: Request
) -> SyncMarkResponse:
    return SyncMarkResponse(
        updated=1 if registry(request).mark_report_synced(report_id, submission_id) else 0
    )


@router.post("/reports/local/{report_id}/purge-raw", response_model=ReportRawDataPurgeResponse)
def purge_local_report_raw_events(report_id: str, request: Request) -> ReportRawDataPurgeResponse:
    return ReportRawDataPurgeResponse(**registry(request).purge_report_raw_events(report_id))


@router.post("/metrics/mark-synced", response_model=SyncMarkResponse)
def mark_local_events_synced(request: Request) -> SyncMarkResponse:
    return SyncMarkResponse(updated=registry(request).mark_events_synced())


@router.post("/sample/prepare", response_model=SamplePrepareResponse)
def prepare_sample_counts(payload: SamplePrepareRequest, request: Request) -> SamplePrepareResponse:
    try:
        return SamplePrepareResponse(
            **registry(request).prepare_sample_counts(
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
