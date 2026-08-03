from fastapi import Request
from fastapi.responses import JSONResponse

from app.storage.local_data_schema import LocalDatabaseResetRequiredError


class CameraApiError(RuntimeError):
    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message


async def local_database_reset_required(_request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, LocalDatabaseResetRequiredError):
        raise exc
    return JSONResponse(
        status_code=409,
        content={"code": "local_database_migration_required", "message": str(exc)},
    )


async def camera_api_error(_request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, CameraApiError):
        raise exc
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.code, "message": exc.message},
    )
