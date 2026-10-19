from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request

from app.api.dependencies import registry

router = APIRouter(prefix="/metrics/open-space", tags=["open-space"])


@router.get("/summary")
@router.get("/history")
@router.get("/visits")
def area_metrics(
    request: Request,
    camera_id: int = Query(ge=1),
    start: datetime | None = None,
    end: datetime | None = None,
    revision_id: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0, le=100_000),
) -> dict[str, Any]:
    now = datetime.now(UTC)
    stop = end or now
    begin = start or (stop - timedelta(days=7))
    try:
        repo = registry(request).area_repository()
        return repo.query(camera_id, begin, stop, revision_id, limit, offset)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
