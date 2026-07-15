from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account
from app.features.final_reports.artifact_envelopes import FinalReportArtifactDetail
from app.features.final_reports.artifact_runtime import (
    get_final_report_artifact_storage,
)
from app.features.final_reports.artifact_service import (
    FinalReportArtifactError,
    FinalReportArtifactForbidden,
    FinalReportArtifactNotFound,
    FinalReportArtifactNotReady,
    FinalReportArtifactUnavailable,
    download_final_report_artifact,
    read_final_report_artifact_metadata,
)
from app.features.final_reports.artifact_storage import ArtifactStorage
from app.features.final_reports.envelopes import (
    FinalizationAcknowledgement,
    FinalizeReportsCommand,
)
from app.features.final_reports.read_envelopes import (
    FinalReportDetail,
    FinalReportPage,
    FinalScopeType,
)
from app.features.final_reports.read_service import (
    FinalReportReadForbidden,
    FinalReportReadInvalidCursor,
    FinalReportReadNotFound,
    list_official_final_reports,
    read_official_final_report,
)
from app.features.final_reports.service import (
    FinalizationConflict,
    FinalizationError,
    finalize_report_command,
)

router = APIRouter(
    prefix="/operational",
    tags=["final-reports-v2"],
)

StaffAccount = Annotated[Account, Depends(require_roles({"staff"}))]
ArtifactAccount = Annotated[Account, Depends(require_roles({"staff", "enterprise"}))]
ArtifactStorageDependency = Annotated[
    ArtifactStorage,
    Depends(get_final_report_artifact_storage),
]


@router.get("/reports/finalizations/v2", response_model=FinalReportPage)
async def list_final_reports_v2(
    account: StaffAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    cursor: Annotated[str | None, Query(max_length=1024)] = None,
    reportingPeriodId: UUID | None = None,
    scopeType: FinalScopeType | None = None,
) -> FinalReportPage:
    try:
        return await list_official_final_reports(
            db,
            account=account,
            limit=limit,
            cursor=cursor,
            reporting_period_id=reportingPeriodId,
            scope_type=scopeType,
        )
    except FinalReportReadForbidden as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except FinalReportReadInvalidCursor as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.get(
    "/reports/finalizations/{report_finalization_id}/v2",
    response_model=FinalReportDetail,
)
async def read_final_report_v2(
    report_finalization_id: UUID,
    account: StaffAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
    versionId: UUID | None = None,
) -> FinalReportDetail:
    try:
        return await read_official_final_report(
            db,
            account=account,
            report_finalization_id=report_finalization_id,
            version_id=versionId,
        )
    except FinalReportReadForbidden as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except FinalReportReadNotFound as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.post(
    "/reports/finalizations/v2",
    response_model=FinalizationAcknowledgement,
)
async def finalize_reports_v2(
    command: FinalizeReportsCommand,
    account: StaffAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> FinalizationAcknowledgement:
    try:
        acknowledgement = await finalize_report_command(db, account=account, command=command)
        await db.commit()
        return acknowledgement
    except FinalizationConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except FinalizationError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.get(
    "/reports/finalizations/{report_finalization_id}/artifacts/{artifact_id}/v2",
    response_model=FinalReportArtifactDetail,
)
async def read_final_report_artifact_v2(
    report_finalization_id: UUID,
    artifact_id: UUID,
    account: ArtifactAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
    storage: ArtifactStorageDependency,
) -> FinalReportArtifactDetail:
    try:
        return await read_final_report_artifact_metadata(
            db,
            storage=storage,
            account=account,
            report_finalization_id=str(report_finalization_id),
            artifact_id=str(artifact_id),
        )
    except (
        FinalReportArtifactForbidden,
        FinalReportArtifactNotFound,
        FinalReportArtifactUnavailable,
    ) as exc:
        raise _artifact_http_exception(exc) from exc


@router.get(
    "/reports/finalizations/{report_finalization_id}/artifacts/{artifact_id}/download/v2",
    response_class=Response,
)
async def download_final_report_artifact_v2(
    report_finalization_id: UUID,
    artifact_id: UUID,
    account: ArtifactAccount,
    db: Annotated[AsyncSession, Depends(get_db)],
    storage: ArtifactStorageDependency,
) -> Response:
    try:
        artifact = await download_final_report_artifact(
            db,
            storage=storage,
            account=account,
            report_finalization_id=str(report_finalization_id),
            artifact_id=str(artifact_id),
        )
    except (
        FinalReportArtifactForbidden,
        FinalReportArtifactNotFound,
        FinalReportArtifactNotReady,
        FinalReportArtifactUnavailable,
    ) as exc:
        raise _artifact_http_exception(exc) from exc
    return Response(
        content=artifact.content,
        media_type=artifact.mime_type,
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": f'attachment; filename="{artifact.filename}"',
            "Content-Length": str(artifact.size_bytes),
            "ETag": f'"{artifact.content_hash}"',
        },
    )


def _artifact_http_exception(exc: FinalReportArtifactError) -> HTTPException:
    if isinstance(exc, FinalReportArtifactForbidden):
        status_code = status.HTTP_403_FORBIDDEN
    elif isinstance(exc, FinalReportArtifactNotFound):
        status_code = status.HTTP_404_NOT_FOUND
    elif isinstance(exc, FinalReportArtifactNotReady):
        status_code = status.HTTP_409_CONFLICT
    elif isinstance(exc, FinalReportArtifactUnavailable):
        status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    else:  # pragma: no cover - closed union at all call sites
        raise TypeError("Unsupported final-report artifact error.")
    return HTTPException(
        status_code=status_code,
        detail={"code": exc.code, "message": exc.message},
    )
