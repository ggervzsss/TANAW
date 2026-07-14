import argparse
import json
import os
import shutil
import sqlite3
import sys
from pathlib import Path
from typing import Any

APP_DIRECTORY_NAME = "desktop-tanaw"
DATABASE_NAME = "tanaw_metrics.sqlite3"
LEDGER_TABLES = (
    "local_schema_migrations",
    "local_sites",
    "local_cameras",
    "local_camera_event_sequences",
    "camera_live_state",
    "count_events",
    "reporting_periods",
    "local_reports",
    "local_report_revisions",
    "local_report_source_batches",
    "local_report_event_claims",
    "local_report_event_memberships",
    "sync_outbox_items",
    "sync_attempts",
    "monitoring_sessions",
    "coverage_gaps",
    "metric_rollups",
    "local_persistence_errors",
    "occupancy_corrections",
    "visitor_identities",
    "visitor_model_embeddings",
    "visitor_sightings",
)
LEGACY_FILES = (
    "active_session.json",
    "events.jsonl",
    DATABASE_NAME,
    f"{DATABASE_NAME}-shm",
    f"{DATABASE_NAME}-wal",
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
        removed_bytes += _directory_size(enterprise_root)
        removed_paths.append(str(enterprise_root))
        shutil.rmtree(enterprise_root)
    for name in LEGACY_FILES:
        path = ml_root / name
        if path.exists():
            removed_bytes += path.stat().st_size
            removed_paths.append(str(path))
            path.unlink()
    return {
        "scope": "all-ledgers",
        "path": str(ml_root),
        "removedPaths": removed_paths,
        "removedBytes": removed_bytes,
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
        "inspect", help="Show ledger locations, row counts, provenance, and recent records."
    )
    inspect_parser.add_argument("--enterprise", help="Inspect only one enterprise ID.")
    inspect_parser.add_argument(
        "--limit", type=int, default=10, choices=range(1, 101), metavar="1-100"
    )
    inspect_parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")

    clear_parser = subparsers.add_parser("clear", help="Delete locally persisted desktop data.")
    selection = clear_parser.add_mutually_exclusive_group(required=True)
    selection.add_argument(
        "--enterprise", help="Delete one enterprise's local ledger and ML session files."
    )
    selection.add_argument(
        "--all-ledgers",
        action="store_true",
        help="Delete every enterprise ledger and the legacy unscoped ledger.",
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
    legacy_path = ml_root / DATABASE_NAME
    if legacy_path.exists():
        paths.append(("legacy-unscoped", legacy_path))
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
        "eventProvenance": [],
        "currentDraftEvents": 0,
        "eventRange": {"first": None, "last": None},
        "recentEvents": [],
        "recentReports": [],
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
        if "count_events" in existing_tables:
            result["eventProvenance"] = [
                {
                    "sourceKind": row["source_kind"],
                    "mockRunId": row["mock_run_id"],
                    "count": row["record_count"],
                }
                for row in connection.execute(
                    """
                    select source_kind, mock_run_id, count(*) as record_count
                    from count_events
                    group by source_kind, mock_run_id
                    order by source_kind, mock_run_id
                    """
                )
            ]
            result["currentDraftEvents"] = connection.execute(
                """
                select count(*)
                from count_events as event
                where not exists (
                    select 1
                    from local_report_event_claims as claim
                    where claim.event_id = event.event_id
                )
                """
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
                    select event.event_id, event.recorded_at, event.camera_name,
                           event.direction, event.occupancy_count, event.visitor_id,
                           event.source_kind, event.mock_run_id, claim.report_id
                    from count_events as event
                    left join local_report_event_claims as claim
                      on claim.event_id = event.event_id
                    order by event.recorded_at desc
                    limit ?
                    """,
                    (limit,),
                )
            ]
        if "local_reports" in existing_tables:
            result["recentReports"] = [
                dict(row)
                for row in connection.execute(
                    """
                    select report.report_id, report.period_label as period,
                           revision.submitted_at, revision.entries, revision.exits,
                           revision.peak_occupancy, revision.unique_count,
                           outbox.status as delivery_status, revision.source_kind,
                           revision.mock_run_id, outbox.acknowledged_at
                    from local_reports as report
                    join local_report_revisions as revision
                      on revision.revision_id = report.current_revision_id
                    join sync_outbox_items as outbox
                      on outbox.report_revision_id = revision.revision_id
                    order by revision.submitted_at desc
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
        print(f"  Current draft events: {ledger['currentDraftEvents']}")
        print(f"  Event range: {ledger['eventRange']['first']} to {ledger['eventRange']['last']}")
        print("  Tables:")
        for table, count in ledger["tables"].items():
            print(f"    {table}: {count}")
        print("  Event provenance:")
        if ledger["eventProvenance"]:
            for provenance in ledger["eventProvenance"]:
                run = provenance["mockRunId"] or "-"
                print(f"    {provenance['sourceKind']} / run {run}: {provenance['count']}")
        else:
            print("    none")
        print("  Recent reports:")
        if ledger["recentReports"]:
            for report in ledger["recentReports"]:
                print(
                    f"    {report['report_id']} | {report['period']} | "
                    f"{report['source_kind']} | {report['delivery_status']}"
                )
        else:
            print("    none")
        print("  Recent events:")
        if ledger["recentEvents"]:
            for event in ledger["recentEvents"]:
                print(
                    f"    {event['recorded_at']} | {event['direction']} | "
                    f"{event['source_kind']} | report {event['report_id'] or '-'}"
                )
        else:
            print("    none")


if __name__ == "__main__":
    main()
