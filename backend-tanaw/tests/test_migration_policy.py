from types import SimpleNamespace

from app.db.migration_policy import (
    include_target_schema_object,
    is_managed_rollup_partition_name,
)


def test_only_canonical_monthly_rollup_partition_names_are_managed() -> None:
    assert is_managed_rollup_partition_name("site_telemetry_hourly_rollups_202607")
    assert not is_managed_rollup_partition_name("site_telemetry_hourly_rollups")
    assert not is_managed_rollup_partition_name("site_telemetry_hourly_rollups_20267")
    assert not is_managed_rollup_partition_name("site_telemetry_hourly_rollups_202607_backup")


def test_autogenerate_excludes_reflected_partition_children_and_their_indexes() -> None:
    child_name = "site_telemetry_hourly_rollups_202607"
    child = SimpleNamespace(name=child_name)
    child_index = SimpleNamespace(table=child)

    assert not include_target_schema_object(child, child_name, "table", True, None)
    assert not include_target_schema_object(child_index, "generated_index", "index", True, None)


def test_autogenerate_includes_target_and_unrecognized_relations() -> None:
    registry = SimpleNamespace(name="site_telemetry_rollup_partitions")
    unmanaged = SimpleNamespace(name="unexpected_table")

    assert include_target_schema_object(registry, registry.name, "table", True, None)
    assert include_target_schema_object(unmanaged, unmanaged.name, "table", True, None)
    assert include_target_schema_object(unmanaged, unmanaged.name, "table", False, None)
