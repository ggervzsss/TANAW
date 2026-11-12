"""Unified report summaries; individual cameras remain available as diagnostics."""

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app.api.dependencies import registry
from app.config.report_config import reporting_period_key
from app.storage.repositories.establishment_repository import TIMEZONE

router = APIRouter(prefix="/metrics/establishment", tags=["establishment"])


@router.get("/periods")
def establishment_periods(request: Request) -> list[dict[str, Any]]:
    try:
        return registry(request).establishment_report_periods()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/summary")
def establishment_summary(
    request: Request,
    start: datetime | None = None,
    end: datetime | None = None,
    period: str | None = None,
) -> dict[str, Any]:
    today = (
        datetime.now(UTC).astimezone(TIMEZONE).replace(hour=0, minute=0, second=0, microsecond=0)
    )
    begin = start or today.replace(day=1)
    stop = end or today + timedelta(days=1)
    try:
        if period is not None:
            key = reporting_period_key(period)
            if key is None or start is not None or end is not None:
                raise ValueError("Select a Month YYYY period or a date range, not both.")
            year, month = key
            begin = datetime(year, month, 1, tzinfo=TIMEZONE)
            stop = datetime(
                year + (month == 12), 1 if month == 12 else month + 1, 1, tzinfo=TIMEZONE
            )
        return registry(request).establishment_summary(begin, stop)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/live")
def establishment_live(request: Request) -> dict[str, Any]:
    try:
        return registry(request).establishment_live()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
