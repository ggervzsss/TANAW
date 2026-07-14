import re
from typing import Any

_MANAGED_ROLLUP_PARTITION = re.compile(r"site_telemetry_hourly_rollups_[0-9]{6}\Z")


def is_managed_rollup_partition_name(name: str | None) -> bool:
    """Return whether a relation is a runtime-managed monthly rollup partition."""

    return name is not None and _MANAGED_ROLLUP_PARTITION.fullmatch(name) is not None


def include_target_schema_object(
    schema_object: Any,
    name: str | None,
    object_type: str,
    reflected: bool,
    compare_to: Any,
) -> bool:
    """Exclude only dynamic partition children from Alembic target comparison.

    The parent and registry are modeled target tables. Monthly children are
    created and retired by the retention service, so treating them as static
    migration objects would make every catalog comparison time-dependent.
    """

    del compare_to
    if not reflected:
        return True
    if object_type == "table":
        relation_name = name
    else:
        relation_name = getattr(getattr(schema_object, "table", None), "name", None)
    return not is_managed_rollup_partition_name(relation_name)
