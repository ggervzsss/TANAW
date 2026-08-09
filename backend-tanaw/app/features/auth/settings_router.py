import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.features.accounts.dependencies import (
    get_current_account,
)
from app.features.accounts.models import Account, AccountRole, SystemConfiguration
from app.features.accounts.service import (
    get_account_preferences,
    set_account_preferences,
)
from app.features.activity_logs.service import (
    record_activity_log as record_auth_log,
)
from app.features.auth.schemas import (
    AccountPreferences,
    SystemSettingsPayload,
)
from app.features.auth.system_settings import load_system_settings_values

logger = logging.getLogger(__name__)

SYSTEM_SETTINGS_ID = "default"
router = APIRouter(prefix="/auth", tags=["account settings"])


@router.get("/preferences", response_model=AccountPreferences)
async def get_preferences(
    account: Annotated[Account, Depends(get_current_account)],
) -> AccountPreferences:
    values = get_account_preferences(account)
    return AccountPreferences.model_validate(values)


@router.patch("/preferences", response_model=AccountPreferences)
async def update_preferences(
    payload: AccountPreferences,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountPreferences:
    values = get_account_preferences(account)
    patch_values = payload.model_dump(mode="json", exclude_unset=True)
    values.update(patch_values)
    set_account_preferences(account, values)
    await db.flush()
    return AccountPreferences.model_validate(values)


@router.get("/system-settings", response_model=SystemSettingsPayload)
async def get_system_settings(
    _: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SystemSettingsPayload:
    record = await db.scalar(
        select(SystemConfiguration).where(SystemConfiguration.id == SYSTEM_SETTINGS_ID)
    )
    return SystemSettingsPayload(
        values=load_system_settings_values(record),
        updatedBy=record.updated_by if record else None,
        updatedAt=record.updated_at if record else None,
    )


@router.patch("/system-settings", response_model=SystemSettingsPayload)
async def update_system_settings(
    payload: SystemSettingsPayload,
    account: Annotated[Account, Depends(get_current_account)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> SystemSettingsPayload:
    if account.role != AccountRole.IT:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="IT Personnel access required."
        )
    record = await db.scalar(
        select(SystemConfiguration).where(SystemConfiguration.id == SYSTEM_SETTINGS_ID)
    )
    if record is None:
        record = SystemConfiguration(id=SYSTEM_SETTINGS_ID)
        db.add(record)
    record.values_json = json.dumps(payload.values, sort_keys=True)
    record.updated_by = account.display_name
    await db.flush()
    await db.refresh(record)
    await record_auth_log(
        db,
        category="IT Activity",
        severity="Success",
        actor=account.display_name,
        actor_role="IT Personnel",
        action="Update System Settings",
        target="TANAW Configuration",
        summary=f"{account.display_name} saved persistent system settings.",
        source_id=record.id,
    )
    return SystemSettingsPayload(
        values=payload.values,
        updatedBy=record.updated_by,
        updatedAt=record.updated_at,
    )
