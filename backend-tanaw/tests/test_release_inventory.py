import json
import subprocess
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def test_release_source_inventory_matches_the_declared_architecture() -> None:
    result = subprocess.run(
        [sys.executable, str(REPOSITORY_ROOT / "scripts/verify_release.py")],
        cwd=REPOSITORY_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stdout + result.stderr
    inventory = json.loads(result.stdout)
    assert inventory["status"] == "verified"
    assert inventory["databaseSchemaRevision"] == "20260715_0001"
    assert inventory["contractVersion"] == 2
    assert inventory["packageVersions"] == {
        "backend-tanaw/pyproject.toml": "2.0.0",
        "desktop-tanaw/ml-service/pyproject.toml": "2.0.0",
        "desktop-tanaw/package.json": "2.0.0",
        "frontend-tanaw/package.json": "2.0.0",
    }
