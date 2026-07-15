#!/usr/bin/env python3
"""Prove that source and production bundles contain only the TANAW target generation."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOTS = (
    Path("backend-tanaw/app"),
    Path("frontend-tanaw/src"),
    Path("desktop-tanaw/src"),
    Path("desktop-tanaw/electron"),
    Path("desktop-tanaw/ml-service/app"),
)
BUILD_ROOTS = (
    Path("frontend-tanaw/dist"),
    Path("desktop-tanaw/dist"),
    Path("desktop-tanaw/dist-electron"),
)
FORBIDDEN_PATHS = (
    Path("backend-tanaw/app/features/operational"),
    Path("frontend-tanaw/src/app/store/reportStore.ts"),
    Path("frontend-tanaw/src/features/reports/utils/dotDemographics.ts"),
    Path("desktop-tanaw/ml-service/app/storage/local_metrics_store.py"),
    Path("desktop-tanaw/ml-service/app/storage/session_store.py"),
    Path("desktop-tanaw/ml-service/app/storage/resilience_store.py"),
)
FORBIDDEN_RUNTIME_TOKENS = (
    "enterprise_report_submissions",
    "enterprise_telemetry_snapshots",
    "final_report_sources",
    "report_migration_exceptions",
    "telemetry_migration_exceptions",
    '"/operational/desktop/report-submissions"',
    '"/operational/desktop/telemetry"',
    '"/operational/telemetry/latest"',
    '"/operational/telemetry/summary"',
    '"/operational/map-enterprises"',
    '"/reports/local-submit"',
    '"alert.created"',
    '"alert.updated"',
    '"alert.resolved"',
    '"notification.created"',
    '"notification.updated"',
    "unsyncedEvents",
    "mark_events_synced",
    "mark_report_synced",
)
TEXT_SUFFIXES = {
    ".cjs",
    ".css",
    ".html",
    ".js",
    ".json",
    ".jsx",
    ".mjs",
    ".py",
    ".ts",
    ".tsx",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--require-builds",
        action="store_true",
        help="Require and inspect the portal and desktop production build directories.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    failures: list[str] = []
    scanned: list[Path] = []

    for relative_path in FORBIDDEN_PATHS:
        if (REPOSITORY_ROOT / relative_path).exists():
            failures.append(f"forbidden path exists: {relative_path}")

    roots = list(SOURCE_ROOTS)
    if args.require_builds:
        for relative_path in BUILD_ROOTS:
            if not (REPOSITORY_ROOT / relative_path).is_dir():
                failures.append(f"required production build is missing: {relative_path}")
        roots.extend(BUILD_ROOTS)

    for relative_root in roots:
        root = REPOSITORY_ROOT / relative_root
        if not root.is_dir():
            failures.append(f"release root is missing: {relative_root}")
            continue
        for path in sorted(root.rglob("*")):
            if not _is_scannable(path):
                continue
            scanned.append(path)
            content = path.read_text(encoding="utf-8", errors="ignore")
            for token in FORBIDDEN_RUNTIME_TOKENS:
                if token in content:
                    failures.append(
                        f"forbidden runtime token {token!r} in {path.relative_to(REPOSITORY_ROOT)}"
                    )

    package_versions = {
        package_path.as_posix(): json.loads((REPOSITORY_ROOT / package_path).read_text())["version"]
        for package_path in (
            Path("desktop-tanaw/package.json"),
            Path("frontend-tanaw/package.json"),
        )
    }
    if set(package_versions.values()) != {"2.0.0"}:
        failures.append(f"target package versions are not exact: {package_versions}")

    inventory = {
        "contractVersion": 2,
        "releaseId": "target-cutover-release",
        "packageVersions": package_versions,
        "buildsInspected": args.require_builds,
        "filesScanned": len(scanned),
        "inventorySha256": _inventory_hash(scanned),
        "status": "failed" if failures else "verified",
        "failures": failures,
    }
    print(json.dumps(inventory, indent=2, sort_keys=True))
    return 1 if failures else 0


def _is_scannable(path: Path) -> bool:
    if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
        return False
    relative_parts = path.relative_to(REPOSITORY_ROOT).parts
    if "__pycache__" in relative_parts or any(".test." in part for part in relative_parts):
        return False
    return True


def _inventory_hash(paths: list[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths):
        relative_path = path.relative_to(REPOSITORY_ROOT).as_posix()
        digest.update(relative_path.encode())
        digest.update(b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return f"sha256:{digest.hexdigest()}"


if __name__ == "__main__":
    sys.exit(main())
