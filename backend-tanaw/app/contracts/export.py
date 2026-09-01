import json
from typing import Any

from pydantic import TypeAdapter

from app.features.realtime.contracts import (
    RealtimeEnvelope,
    RealtimeHeartbeat,
    RealtimeReady,
)


def build_contract_bundle() -> dict[str, Any]:
    """Return the canonical REST and realtime schemas without starting a server."""
    from app.main import app

    realtime_schema = TypeAdapter(RealtimeEnvelope | RealtimeReady | RealtimeHeartbeat).json_schema(
        ref_template="#/components/schemas/{model}"
    )
    realtime_schemas = realtime_schema["$defs"]
    realtime_schemas.pop("JSONValue")
    realtime_schemas["RealtimeEnvelope"]["properties"]["payload"] = {
        "type": "object",
        "additionalProperties": True,
    }

    return {
        "openapi": app.openapi(),
        "realtime": {
            "openapi": "3.1.0",
            "info": {"title": "TANAW Realtime Contract", "version": "1"},
            "paths": {},
            "components": {"schemas": realtime_schemas},
        },
    }


def serialize_contract_bundle() -> str:
    """Serialize contracts deterministically for the TypeScript generator."""
    return json.dumps(build_contract_bundle(), sort_keys=True, separators=(",", ":"))


def main() -> None:
    print(serialize_contract_bundle())


if __name__ == "__main__":
    main()
