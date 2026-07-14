from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import require_roles
from app.features.accounts.models import Account
from app.features.telemetry.envelopes import (
    EnterpriseSitePage,
    EpochStartAcknowledgement,
    EpochStartCommand,
    SiteLiveStatePage,
    SiteLiveStateResponse,
    TelemetryAcknowledgement,
    TelemetryCommand,
)
from app.features.telemetry.service import (
    TelemetryIntakeConflict,
    TelemetryIntakeError,
    get_official_live_site,
    ingest_telemetry_command,
    list_enterprise_live_sites,
    list_enterprise_sites,
    list_official_live_sites,
    list_official_sites,
    register_epoch_command,
)

router = APIRouter(prefix="/operational", tags=["telemetry-v2"])

EnterpriseAccount = Annotated[Account, Depends(require_roles({"enterprise"}))]
MapAccount = Annotated[Account, Depends(require_roles({"admin", "staff", "it"}))]
Database = Annotated[AsyncSession, Depends(get_db)]


@router.post(
    "/desktop/telemetry-epochs/v2",
    response_model=EpochStartAcknowledgement,
)
async def start_telemetry_epoch_v2(
    command: EpochStartCommand,
    account: EnterpriseAccount,
    db: Database,
) -> EpochStartAcknowledgement:
    try:
        acknowledgement = await register_epoch_command(db, account=account, command=command)
        await db.commit()
        return acknowledgement
    except TelemetryIntakeConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except TelemetryIntakeError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.post(
    "/desktop/telemetry/v2",
    response_model=TelemetryAcknowledgement,
)
async def ingest_telemetry_v2(
    command: TelemetryCommand,
    account: EnterpriseAccount,
    db: Database,
) -> TelemetryAcknowledgement:
    try:
        acknowledgement = await ingest_telemetry_command(db, account=account, command=command)
        await db.commit()
        return acknowledgement
    except TelemetryIntakeConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    except TelemetryIntakeError as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.get("/live/sites/v2", response_model=SiteLiveStatePage)
async def get_official_live_sites_v2(
    _: MapAccount,
    db: Database,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    afterSiteId: UUID | None = None,
) -> SiteLiveStatePage:
    return await list_official_live_sites(
        db,
        limit=limit,
        after_site_id=afterSiteId,
    )


@router.get("/sites/v2", response_model=EnterpriseSitePage)
async def get_official_sites_v2(
    _: MapAccount,
    db: Database,
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
    afterSiteId: UUID | None = None,
) -> EnterpriseSitePage:
    return await list_official_sites(
        db,
        limit=limit,
        after_site_id=afterSiteId,
    )


@router.get("/live/sites/{site_id}/v2", response_model=SiteLiveStateResponse)
async def get_official_live_site_v2(
    site_id: UUID,
    _: MapAccount,
    db: Database,
) -> SiteLiveStateResponse:
    try:
        return await get_official_live_site(db, site_id=site_id)
    except TelemetryIntakeError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.get("/desktop/live/sites/v2", response_model=SiteLiveStatePage)
async def get_enterprise_live_sites_v2(
    account: EnterpriseAccount,
    db: Database,
    limit: Annotated[int, Query(ge=1, le=50)] = 25,
    afterSiteId: UUID | None = None,
) -> SiteLiveStatePage:
    try:
        return await list_enterprise_live_sites(
            db,
            account=account,
            limit=limit,
            after_site_id=afterSiteId,
        )
    except TelemetryIntakeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc


@router.get("/desktop/sites/v2", response_model=EnterpriseSitePage)
async def get_enterprise_sites_v2(
    account: EnterpriseAccount,
    db: Database,
    limit: Annotated[int, Query(ge=1, le=50)] = 25,
    afterSiteId: UUID | None = None,
) -> EnterpriseSitePage:
    try:
        return await list_enterprise_sites(
            db,
            account=account,
            limit=limit,
            after_site_id=afterSiteId,
        )
    except TelemetryIntakeError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
