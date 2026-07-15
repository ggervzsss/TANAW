"""Deterministic export of the operational HTTP contract."""

from __future__ import annotations

from collections import deque
from copy import deepcopy
from typing import Any

from fastapi import FastAPI

OPERATIONAL_PATH_PREFIXES = ("/operational/",)
OPERATIONAL_EXACT_PATHS = frozenset({"/maintenance/operations"})
SCHEMA_REFERENCE_PREFIX = "#/components/schemas/"


def build_operational_contract(app: FastAPI) -> dict[str, Any]:
    openapi = app.openapi()
    paths = {
        path: deepcopy(value)
        for path, value in sorted(openapi["paths"].items())
        if path.startswith(OPERATIONAL_PATH_PREFIXES) or path in OPERATIONAL_EXACT_PATHS
    }
    referenced_schemas = _referenced_schema_names(paths)
    all_schemas = openapi.get("components", {}).get("schemas", {})
    schemas: dict[str, Any] = {}
    pending = deque(sorted(referenced_schemas))
    while pending:
        name = pending.popleft()
        if name in schemas:
            continue
        schema = all_schemas.get(name)
        if schema is None:
            raise ValueError(f"Operational OpenAPI references an unknown schema: {name}")
        schemas[name] = deepcopy(schema)
        for dependency in sorted(_referenced_schema_names(schema)):
            if dependency not in schemas:
                pending.append(dependency)

    components: dict[str, Any] = {"schemas": dict(sorted(schemas.items()))}
    security_schemes = openapi.get("components", {}).get("securitySchemes")
    if security_schemes:
        components["securitySchemes"] = deepcopy(security_schemes)
    return {
        "openapi": openapi["openapi"],
        "info": {
            "title": openapi["info"]["title"],
            "version": openapi["info"]["version"],
        },
        "paths": paths,
        "components": components,
    }


def _referenced_schema_names(value: object) -> set[str]:
    references: set[str] = set()
    pending: list[object] = [value]
    while pending:
        current = pending.pop()
        if isinstance(current, dict):
            reference = current.get("$ref")
            if isinstance(reference, str) and reference.startswith(SCHEMA_REFERENCE_PREFIX):
                references.add(reference.removeprefix(SCHEMA_REFERENCE_PREFIX))
            pending.extend(current.values())
        elif isinstance(current, list):
            pending.extend(current)
    return references
