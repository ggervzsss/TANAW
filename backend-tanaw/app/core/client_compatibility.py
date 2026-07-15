import hmac
import re
from dataclasses import dataclass

from fastapi import Request, WebSocket, status
from starlette.responses import JSONResponse

from app.core.config import Settings

CLIENT_NAME_HEADER = "X-TANAW-Client-Name"
CLIENT_VERSION_HEADER = "X-TANAW-Client-Version"
CONTRACT_VERSION_HEADER = "X-TANAW-Contract-Version"
RELEASE_ID_HEADER = "X-TANAW-Release-ID"
CLIENT_COMPATIBILITY_HEADERS = [
    CLIENT_NAME_HEADER,
    CLIENT_VERSION_HEADER,
    CONTRACT_VERSION_HEADER,
    RELEASE_ID_HEADER,
]

DESKTOP_CLIENT_NAME = "enterprise-desktop"
PORTAL_CLIENT_NAME = "web-portal"
MANDATORY_UPGRADE_WEBSOCKET_CODE = 4406
MANDATORY_UPGRADE_REASON = "CLIENT_UPGRADE_REQUIRED"
_SEMANTIC_VERSION = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


@dataclass(frozen=True, slots=True)
class ClientGeneration:
    name: str | None
    version: str | None
    contract_version: str | None
    release_id: str | None


def desktop_request_requires_compatibility(request: Request) -> bool:
    return request.method != "OPTIONS" and request.url.path.startswith("/operational/desktop/")


def request_client_generation(request: Request) -> ClientGeneration:
    return ClientGeneration(
        name=request.headers.get(CLIENT_NAME_HEADER),
        version=request.headers.get(CLIENT_VERSION_HEADER),
        contract_version=request.headers.get(CONTRACT_VERSION_HEADER),
        release_id=request.headers.get(RELEASE_ID_HEADER),
    )


def is_supported_client_generation(
    generation: ClientGeneration,
    settings: Settings,
    *,
    allowed_client_names: frozenset[str] = frozenset({DESKTOP_CLIENT_NAME, PORTAL_CLIENT_NAME}),
) -> bool:
    if generation.name not in allowed_client_names:
        return False
    version = parse_semantic_version(generation.version)
    minimum = parse_semantic_version(settings.minimum_client_version)
    if version is None or minimum is None:
        return False
    if version < minimum or version[0] >= settings.maximum_client_major_exclusive:
        return False
    if generation.contract_version != str(settings.client_contract_version):
        return False
    if generation.release_id is None:
        return False
    return hmac.compare_digest(generation.release_id, settings.target_release_id)


def desktop_upgrade_required_response(settings: Settings) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_426_UPGRADE_REQUIRED,
        content={
            "contractVersion": settings.client_contract_version,
            "error": {
                "code": MANDATORY_UPGRADE_REASON,
                "message": "Update TANAW Desktop before synchronizing.",
                "retryable": False,
                "minimumClientVersion": settings.minimum_client_version,
                "requiredContractVersion": settings.client_contract_version,
            },
        },
    )


async def reject_unsupported_websocket_generation(
    websocket: WebSocket,
    generation: ClientGeneration,
    settings: Settings,
) -> bool:
    if is_supported_client_generation(generation, settings):
        return False
    await websocket.close(
        code=MANDATORY_UPGRADE_WEBSOCKET_CODE,
        reason=MANDATORY_UPGRADE_REASON,
    )
    return True


def parse_semantic_version(value: str | None) -> tuple[int, int, int] | None:
    if value is None:
        return None
    match = _SEMANTIC_VERSION.fullmatch(value.strip())
    if match is None:
        return None
    return tuple(int(part) for part in match.groups())  # type: ignore[return-value]
