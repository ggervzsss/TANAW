#!/usr/bin/env python3
"""Produce a deterministic inventory for a TANAW release."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import sys
import tomllib
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
RELEASE_ID = "tanaw-release-2"
CONTRACT_VERSION = 2
PACKAGE_VERSION = "2.0.0"
DATABASE_SCHEMA_REVISION = "20260715_0001"
LOCAL_SCHEMA_VERSION = 8

SOURCE_ROOTS = (
    Path("backend-tanaw/app"),
    Path("backend-tanaw/alembic/versions"),
    Path("frontend-tanaw/src"),
    Path("desktop-tanaw/src"),
    Path("desktop-tanaw/electron"),
    Path("desktop-tanaw/ml-service/app"),
    Path("shared-contracts"),
)
BUILD_ROOTS = (
    Path("frontend-tanaw/dist"),
    Path("desktop-tanaw/dist"),
    Path("desktop-tanaw/dist-electron"),
)
OPERATOR_GUIDES = (
    Path("README.md"),
    Path("TLDR.md"),
    Path("scripts/README.md"),
    Path(".env.example"),
)
REQUIRED_PATHS = (
    Path("backend-tanaw/alembic/versions/20260715_0001_create_initial_schema.py"),
    Path("backend-tanaw/alembic/versions/20260715_0001_database_ddl.sql"),
    Path("backend-tanaw/app/features/reporting"),
    Path("backend-tanaw/app/features/telemetry"),
    Path("backend-tanaw/app/features/final_reports"),
    Path("backend-tanaw/app/features/topology"),
    Path("backend-tanaw/app/features/events"),
    Path("backend-tanaw/app/features/simulation"),
    Path("desktop-tanaw/ml-service/app/storage/local_ledger.py"),
    Path("scripts/mockdata-on"),
    Path("scripts/mockdata-reset"),
    Path("scripts/mockdata-status"),
    Path("scripts/mockdata-off"),
    Path("scripts/local-data-reset"),
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
    ".sql",
    ".ts",
    ".tsx",
}
CONTRACT_PATH = Path("shared-contracts/operational-v2.openapi.json")
REQUIRED_CONTRACT_PATHS = frozenset(
    {
        "/operational/desktop/report-submissions/v2",
        "/operational/desktop/telemetry/v2",
        "/operational/reports/finalizations/v2",
        "/maintenance/operations",
    }
)
def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--require-builds",
        action="store_true",
        help="Require and inspect portal and desktop production build directories.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    failures: list[str] = []
    scanned: list[Path] = []

    for relative_path in REQUIRED_PATHS:
        if not (REPOSITORY_ROOT / relative_path).exists():
            failures.append(f"required release path is missing: {relative_path}")

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

    for relative_path in OPERATOR_GUIDES:
        path = REPOSITORY_ROOT / relative_path
        if not path.is_file():
            failures.append(f"operator guide is missing: {relative_path}")
            continue
        scanned.append(path)

    package_versions = _package_versions(failures)
    if set(package_versions.values()) != {PACKAGE_VERSION}:
        failures.append(f"package versions are not exact: {package_versions}")

    _verify_contract(failures)
    schema_heads = _schema_heads(failures)
    if schema_heads != {DATABASE_SCHEMA_REVISION}:
        failures.append(
            f"database schema revision is not exactly {DATABASE_SCHEMA_REVISION}: "
            f"{sorted(schema_heads)}"
        )
    local_schema_version = _integer_assignment(
        REPOSITORY_ROOT / "desktop-tanaw/ml-service/app/storage/ledger_schema.py",
        "LOCAL_SCHEMA_VERSION",
        failures,
    )
    if local_schema_version != LOCAL_SCHEMA_VERSION:
        failures.append(
            f"local schema version is not exactly {LOCAL_SCHEMA_VERSION}: "
            f"{local_schema_version!r}"
        )

    inventory = {
        "databaseSchemaRevision": DATABASE_SCHEMA_REVISION,
        "contractVersion": CONTRACT_VERSION,
        "releaseId": RELEASE_ID,
        "localSchemaVersion": LOCAL_SCHEMA_VERSION,
        "packageVersions": package_versions,
        "buildsInspected": args.require_builds,
        "filesScanned": len(set(scanned)),
        "inventorySha256": _inventory_hash(list(set(scanned))),
        "status": "failed" if failures else "verified",
        "failures": failures,
    }
    print(json.dumps(inventory, indent=2, sort_keys=True))
    return 1 if failures else 0


def _package_versions(failures: list[str]) -> dict[str, str]:
    versions: dict[str, str] = {}
    for package_path in (Path("desktop-tanaw/package.json"), Path("frontend-tanaw/package.json")):
        path = REPOSITORY_ROOT / package_path
        versions[package_path.as_posix()] = str(json.loads(path.read_text())["version"])
        lock_path = path.with_name("package-lock.json")
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        lock_version = lock.get("packages", {}).get("", {}).get("version")
        if lock_version != versions[package_path.as_posix()]:
            failures.append(
                f"package lock version mismatch for {package_path}: {lock_version!r}"
            )
    for package_path in (
        Path("backend-tanaw/pyproject.toml"),
        Path("desktop-tanaw/ml-service/pyproject.toml"),
    ):
        versions[package_path.as_posix()] = str(
            tomllib.loads((REPOSITORY_ROOT / package_path).read_text(encoding="utf-8"))[
                "project"
            ]["version"]
        )
    return versions


def _verify_contract(failures: list[str]) -> None:
    contract_path = REPOSITORY_ROOT / CONTRACT_PATH
    if not contract_path.is_file():
        failures.append(f"shared operational contract is missing: {CONTRACT_PATH}")
        return
    contract = json.loads(contract_path.read_text(encoding="utf-8"))
    if contract.get("info", {}).get("version") != PACKAGE_VERSION:
        failures.append(f"shared operational contract does not advertise {PACKAGE_VERSION}")
    paths = set(contract.get("paths", {}))
    missing_paths = REQUIRED_CONTRACT_PATHS.difference(paths)
    if missing_paths:
        failures.append(f"shared operational contract is missing paths: {sorted(missing_paths)}")


def _schema_heads(failures: list[str]) -> set[str]:
    revisions: dict[str, set[str]] = {}
    directory = REPOSITORY_ROOT / "backend-tanaw/alembic/versions"
    revision_paths = sorted(directory.glob("*.py"))
    expected_paths = {"20260715_0001_create_initial_schema.py"}
    actual_paths = {path.name for path in revision_paths}
    if actual_paths != expected_paths:
        failures.append(
            "database revision inventory is not the single initial schema: "
            f"{sorted(actual_paths)}"
        )
    for path in revision_paths:
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            assignments = _literal_assignments(tree)
            revision = assignments.get("revision")
            down_revision = assignments.get("down_revision")
            if not isinstance(revision, str):
                raise ValueError("revision is not a literal string")
            if down_revision is None:
                parents: set[str] = set()
            elif isinstance(down_revision, str):
                parents = {down_revision}
            elif isinstance(down_revision, tuple) and all(
                isinstance(parent, str) for parent in down_revision
            ):
                parents = set(down_revision)
            else:
                raise ValueError("down_revision is not a string, tuple, or None")
            revisions[revision] = parents
        except (SyntaxError, ValueError) as exc:
            failures.append(f"cannot inventory schema revision {path.name}: {exc}")
    referenced = {parent for parents in revisions.values() for parent in parents}
    unknown = referenced.difference(revisions)
    if unknown:
        failures.append(f"schema graph references unknown revisions: {sorted(unknown)}")
    return set(revisions).difference(referenced)


def _integer_assignment(path: Path, name: str, failures: list[str]) -> int | None:
    try:
        assignments = _literal_assignments(
            ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        )
        value = assignments.get(name)
        return value if isinstance(value, int) else None
    except (OSError, SyntaxError, ValueError) as exc:
        failures.append(f"cannot read {name} from {path.relative_to(REPOSITORY_ROOT)}: {exc}")
        return None


def _literal_assignments(tree: ast.Module) -> dict[str, object]:
    values: dict[str, object] = {}
    for statement in tree.body:
        target: ast.expr | None = None
        value: ast.expr | None = None
        if isinstance(statement, ast.Assign) and len(statement.targets) == 1:
            target, value = statement.targets[0], statement.value
        elif isinstance(statement, ast.AnnAssign):
            target, value = statement.target, statement.value
        if isinstance(target, ast.Name) and value is not None:
            try:
                values[target.id] = ast.literal_eval(value)
            except (ValueError, TypeError):
                continue
    return values


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
