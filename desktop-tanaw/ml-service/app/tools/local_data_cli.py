import argparse
import json
import os
import shutil
import sqlite3
import sys
from pathlib import Path
from typing import Any

APP_DIRECTORY_NAME = "desktop-tanaw"
DATABASE_NAME = "tanaw_desktop.sqlite3"
RETIRED_DATABASE_NAME = "tanaw_metrics.sqlite3"
RETIRED_SESSION_NAME = "active_session.json"
LEDGER_TABLES = (
    "schema_metadata",
    "camera_profiles",
    "active_monitoring_state",
    "camera_monitoring_states",
    "count_events",
    "count_snapshots",
    "occupancy_corrections",
    "report_drafts",
    "report_submissions",
    "report_camera_totals",
    "visitor_identities",
    "visitor_model_embeddings",
    "visitor_sightings",
)


def main(argv: list[str] | None = None) -> None:
    parser = _parser()
    args = parser.parse_args(argv)
    app_data_dir = (
        args.app_data_dir.expanduser().resolve() if args.app_data_dir else default_app_data_dir()
    )

    if args.command == "inspect":
        result = inspect_local_data(app_data_dir, args.enterprise, args.limit)
        if args.json:
            print(json.dumps(result, indent=2, sort_keys=True))
        else:
            _print_inspection(result)
        return

    if not args.yes:
        parser.error(
            "clear is destructive; rerun with --yes after closing the TANAW desktop application"
        )

    result = clear_local_data(
        app_data_dir,
        enterprise_id=args.enterprise,
        all_ledgers=args.all_ledgers,
        full_device=args.full_device,
    )
    print(json.dumps(result, indent=2, sort_keys=True))


def default_app_data_dir() -> Path:
    configured = os.environ.get("TANAW_APP_DATA_DIR")
    if configured:
        return Path(configured).expanduser().resolve()

    if sys.platform == "win32":
        root = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support"
    else:
        root = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return (root / APP_DIRECTORY_NAME).resolve()


def inspect_local_data(
    app_data_dir: Path, enterprise_id: str | None = None, limit: int = 10
) -> dict[str, Any]:
    ledgers = _ledger_paths(app_data_dir, enterprise_id)
    return {
        "appDataDirectory": str(app_data_dir),
        "browserStorageDirectory": str(app_data_dir / "Local Storage"),
        "browserStorageBytes": _directory_size(app_data_dir / "Local Storage"),
        "ledgers": [
            _inspect_ledger(scope, database_path, limit) for scope, database_path in ledgers
        ],
    }


def clear_local_data(
    app_data_dir: Path,
    *,
    enterprise_id: str | None = None,
    all_ledgers: bool = False,
    full_device: bool = False,
) -> dict[str, Any]:
    selections = sum((enterprise_id is not None, all_ledgers, full_device))
    if selections != 1:
        raise ValueError("choose exactly one of --enterprise, --all-ledgers, or --full-device")

    if full_device:
        _validate_full_device_target(app_data_dir)
        removed_bytes = _directory_size(app_data_dir)
        existed = app_data_dir.exists()
        if existed:
            shutil.rmtree(app_data_dir)
        return {
            "scope": "full-device",
            "path": str(app_data_dir),
            "existed": existed,
            "removedBytes": removed_bytes,
            "browserStorageRemoved": True,
        }

    ml_root = app_data_dir / "ml-service"
    if enterprise_id is not None:
        scope = safe_scope(enterprise_id)
        target = ml_root / "enterprises" / scope
        removed_bytes = _directory_size(target)
        existed = target.exists()
        if existed:
            shutil.rmtree(target)
        return {
            "scope": "enterprise",
            "enterpriseId": enterprise_id,
            "path": str(target),
            "existed": existed,
            "removedBytes": removed_bytes,
            "browserStorageRemoved": False,
        }

    removed_paths: list[str] = []
    removed_bytes = 0
    enterprise_root = ml_root / "enterprises"
    if enterprise_root.exists():
        for database_path in sorted(enterprise_root.glob(f"*/{DATABASE_NAME}")):
            removed_bytes += database_path.stat().st_size
            _clear_operational_rows(database_path)
            removed_paths.append(str(database_path))
    retired_paths, retired_bytes = _remove_retired_artifacts(ml_root)
    return {
        "scope": "all-operational-ledgers",
        "path": str(ml_root),
        "removedPaths": removed_paths,
        "removedBytes": removed_bytes + retired_bytes,
        "retiredPathsRemoved": retired_paths,
        "cameraProfilesPreserved": True,
        "browserStorageRemoved": False,
    }


def safe_scope(value: str) -> str:
    normalized = "".join(
        character if character.isalnum() or character in "._-" else "_"
        for character in value.strip()
    )
    return normalized[:160] or "unbound"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="local-data",
        description="Inspect or clear TANAW Enterprise Desktop data stored on this device.",
    )
    parser.add_argument(
        "--app-data-dir",
        type=Path,
        help="Override Electron's user-data directory. Defaults to the current operating system's desktop-tanaw directory.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    inspect_parser = subparsers.add_parser(
        "inspect", help="Show ledger locations, row counts, and recent records."
    )
    inspect_parser.add_argument("--enterprise", help="Inspect only one enterprise ID.")
    inspect_parser.add_argument(
        "--limit", type=int, default=10, choices=range(1, 101), metavar="1-100"
    )
    inspect_parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")

    clear_parser = subparsers.add_parser("clear", help="Delete locally persisted desktop data.")
    selection = clear_parser.add_mutually_exclusive_group(required=True)
    selection.add_argument(
        "--enterprise", help="Delete one enterprise's complete local SQLite database."
    )
    selection.add_argument(
        "--all-ledgers",
        action="store_true",
        help="Clear operational rows from every enterprise database while preserving camera profiles.",
    )
    selection.add_argument(
        "--full-device",
        action="store_true",
        help="Delete the entire Electron user-data directory, including camera settings, device IDs, preferences, and caches.",
    )
    clear_parser.add_argument(
        "--yes", action="store_true", help="Confirm the destructive operation."
    )
    return parser


def _ledger_paths(app_data_dir: Path, enterprise_id: str | None) -> list[tuple[str, Path]]:
    ml_root = app_data_dir / "ml-service"
    if enterprise_id is not None:
        scope = safe_scope(enterprise_id)
        return [(enterprise_id, ml_root / "enterprises" / scope / DATABASE_NAME)]

    paths: list[tuple[str, Path]] = []
    enterprise_root = ml_root / "enterprises"
    if enterprise_root.exists():
        for database_path in sorted(enterprise_root.glob(f"*/{DATABASE_NAME}")):
            paths.append((database_path.parent.name, database_path))
    return paths


def _inspect_ledger(scope: str, database_path: Path, limit: int) -> dict[str, Any]:
    result: dict[str, Any] = {
        "scope": scope,
        "path": str(database_path),
        "exists": database_path.exists(),
        "sizeBytes": database_path.stat().st_size if database_path.exists() else 0,
        "tables": {},
        "currentDraftEvents": 0,
        "eventRange": {"first": None, "last": None},
        "recentEvents": [],
        "recentReports": [],
        "schemaVersion": None,
    }
    if not database_path.exists():
        return result

    connection = sqlite3.connect(f"{database_path.as_uri()}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        existing_tables = {
            str(row["name"])
            for row in connection.execute("select name from sqlite_master where type = 'table'")
        }
        result["tables"] = {
            table: _row_count(connection, table) if table in existing_tables else 0
            for table in LEDGER_TABLES
        }
        if "schema_metadata" in existing_tables:
            version_row = connection.execute(
                "select schema_version from schema_metadata where singleton_id = 1"
            ).fetchone()
            result["schemaVersion"] = (
                int(version_row["schema_version"]) if version_row is not None else None
            )
        if "count_events" in existing_tables:
            result["currentDraftEvents"] = connection.execute(
                "select count(*) from count_events where submitted_report_id is null"
            ).fetchone()[0]
            event_range = connection.execute(
                "select min(recorded_at) as first_recorded_at, max(recorded_at) as last_recorded_at from count_events"
            ).fetchone()
            result["eventRange"] = {
                "first": event_range["first_recorded_at"],
                "last": event_range["last_recorded_at"],
            }
            result["recentEvents"] = [
                dict(row)
                for row in connection.execute(
                    """
                    select event_id, recorded_at, camera_name, direction, occupancy_count,
                           visitor_id, submitted_report_id, synced_at
                    from count_events
                    order by recorded_at desc
                    limit ?
                    """,
                    (limit,),
                )
            ]
        if "report_submissions" in existing_tables:
            result["recentReports"] = [
                dict(row)
                for row in connection.execute(
                    """
                    select report_id, period, submitted_at, entries, exits, peak_occupancy,
                           unique_count, sync_status, synced_at
                    from report_submissions
                    order by submitted_at desc
                    limit ?
                    """,
                    (limit,),
                )
            ]
    finally:
        connection.close()
    return result


def _row_count(connection: sqlite3.Connection, table: str) -> int:
    return int(connection.execute(f'select count(*) from "{table}"').fetchone()[0])


def _clear_operational_rows(database_path: Path) -> None:
    connection = sqlite3.connect(database_path)
    try:
        connection.execute("pragma foreign_keys = on")
        connection.execute("pragma busy_timeout = 5000")
        connection.execute("begin immediate")
        for table in (
            "visitor_sightings",
            "visitor_model_embeddings",
            "visitor_identities",
            "report_camera_totals",
            "count_events",
            "count_snapshots",
            "occupancy_corrections",
            "report_drafts",
            "report_submissions",
            "active_monitoring_state",
            "camera_monitoring_states",
        ):
            connection.execute(f'delete from "{table}"')
        connection.commit()
        connection.execute("pragma wal_checkpoint(truncate)")
    finally:
        connection.close()


def _remove_retired_artifacts(ml_root: Path) -> tuple[list[str], int]:
    scope_roots = [ml_root]
    enterprise_root = ml_root / "enterprises"
    if enterprise_root.exists():
        scope_roots.extend(path for path in enterprise_root.iterdir() if path.is_dir())

    candidates: list[Path] = []
    for scope_root in scope_roots:
        retired_database = scope_root / RETIRED_DATABASE_NAME
        candidates.extend(
            (
                retired_database,
                retired_database.with_name(f"{retired_database.name}-shm"),
                retired_database.with_name(f"{retired_database.name}-wal"),
                scope_root / RETIRED_SESSION_NAME,
            )
        )

    removed_paths: list[str] = []
    removed_bytes = 0
    for candidate in candidates:
        if not candidate.is_file():
            continue
        removed_bytes += candidate.stat().st_size
        candidate.unlink()
        removed_paths.append(str(candidate))
    return removed_paths, removed_bytes


def _directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    if path.is_file():
        return path.stat().st_size
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def _validate_full_device_target(path: Path) -> None:
    resolved = path.resolve()
    forbidden = {Path(resolved.anchor), Path.home().resolve(), Path.cwd().resolve()}
    if resolved in forbidden or len(resolved.parts) < 3:
        raise ValueError(f"refusing to remove unsafe full-device path: {resolved}")


def _print_inspection(result: dict[str, Any]) -> None:
    print(f"Application data: {result['appDataDirectory']}")
    print(
        "Browser local storage: "
        f"{result['browserStorageDirectory']} ({result['browserStorageBytes']} bytes)"
    )
    ledgers = result["ledgers"]
    if not ledgers:
        print("No local TANAW ledgers found.")
        return

    for ledger in ledgers:
        print()
        print(f"Ledger: {ledger['scope']}")
        print(f"  Path: {ledger['path']}")
        if not ledger["exists"]:
            print("  Status: not found")
            continue
        print(f"  Size: {ledger['sizeBytes']} bytes")
        print(f"  Schema version: {ledger['schemaVersion']}")
        print(f"  Current draft events: {ledger['currentDraftEvents']}")
        print(f"  Event range: {ledger['eventRange']['first']} to {ledger['eventRange']['last']}")
        print("  Tables:")
        for table, count in ledger["tables"].items():
            print(f"    {table}: {count}")
        print("  Recent reports:")
        if ledger["recentReports"]:
            for report in ledger["recentReports"]:
                print(f"    {report['report_id']} | {report['period']} | {report['sync_status']}")
        else:
            print("    none")
        print("  Recent events:")
        if ledger["recentEvents"]:
            for event in ledger["recentEvents"]:
                print(
                    f"    {event['recorded_at']} | {event['direction']} | "
                    f"report {event['submitted_report_id'] or '-'}"
                )
        else:
            print("    none")


if __name__ == "__main__":
    main()
