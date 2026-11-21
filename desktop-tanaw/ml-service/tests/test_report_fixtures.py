"""The saved-report fixtures other apps test against must match what this service produces.

Backend and web-portal tests read `tests/fixtures/reports/` as real desktop submissions. When
the report shape here changes, these checks fail until the fixtures are updated with it.
"""

import json
from pathlib import Path
from typing import Any

import pytest
from support.reports import observed, request

from app.identity.establishment_registry import EstablishmentRegistry
from app.storage.repositories.establishment_report_repository import (
    DEMO_FIELDS,
    EstablishmentReportRepository,
    report_metrics,
)
from app.storage.repositories.establishment_repository import snapshot_digest

FIXTURES = Path(__file__).parent / "fixtures" / "reports"
MODES = ["open-space", "entrance-exit", "mixed", "corrected-open-space"]


def fixture(mode: str) -> dict[str, Any]:
    saved: dict[str, Any] = json.loads((FIXTURES / f"{mode}-establishment-report.json").read_text())
    return saved


def produced(tmp_path: Path, mode: str) -> dict[str, Any]:
    """Submit a real report for the same counting mode through this service."""
    service = EstablishmentRegistry(str(tmp_path), "park")
    if mode in {"entrance-exit", "mixed"}:
        observed(service, "doorway")
    if mode in {"open-space", "corrected-open-space", "mixed"}:
        observed(service, "area", internal=True)
    repo = EstablishmentReportRepository(service.database)
    unique = repo.period_summary("October 2026")["counting"]["unique_count"]
    return repo.submit(**request(repo, unique))


def paths(value: Any, path: str = "$") -> set[str]:
    """Every key path in a JSON value; list items share one `[]` path."""
    found = {path}
    if isinstance(value, dict):
        for key, part in value.items():
            found |= paths(part, f"{path}.{key}")
    elif isinstance(value, list):
        for part in value:
            found |= paths(part, f"{path}[]")
    return found


@pytest.mark.parametrize("mode", MODES)
def test_fixture_has_the_same_fields_as_a_real_submission(tmp_path: Path, mode: str) -> None:
    saved, real = paths(fixture(mode)), paths(produced(tmp_path, mode))
    assert sorted(real - saved) == [], "Fixture is missing fields this service now produces."
    # A list the small test submission leaves empty (such as sex models) may hold items here.
    unexplained = [
        path
        for path in saved - real
        if not any(path.startswith(f"{parent}[]") for parent in real if f"{parent}[]" not in real)
    ]
    assert sorted(unexplained) == [], "Fixture has fields this service no longer produces."


@pytest.mark.parametrize("mode", MODES)
def test_fixture_counts_and_digest_agree_with_this_service(mode: str) -> None:
    saved = fixture(mode)
    counting = saved["counting"]
    assert saved["payload"]["counting"] == counting
    assert counting["snapshot_version"] == snapshot_digest(counting)
    metrics = report_metrics(counting)
    assert {key: saved[key] for key in metrics} == metrics
    assert saved["payload"]["metrics"] == {
        "entries": metrics["entries"],
        "exits": metrics["exits"],
        "peak": metrics["peak_occupancy"],
        "unique": metrics["unique_count"],
    }
    demo = saved["payload"]["demo"]
    assert sum(int(demo[field]) for field in DEMO_FIELDS) == metrics["unique_count"]
    assert saved["sync_status"] == "pending_cloud_sync"
