"""Report helpers shared by the establishment report and saved-fixture tests."""

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import numpy as np

from app.identity.establishment_registry import EstablishmentRegistry

OBSERVED = datetime(2026, 10, 10, 2, tzinfo=UTC)

SUBMITTED = datetime(2026, 11, 2, 2, tzinfo=UTC)


def observed(
    service: EstablishmentRegistry,
    key: str = "first",
    *,
    internal: bool = False,
    area_role: str = "internal_observation",
    vector: np.ndarray | None = None,
) -> None:
    service.observe(
        observation_id=key,
        camera_id=1,
        track_key=key,
        analysis_mode="open_space" if internal else "entrance_exit",
        kind="area_visit" if internal else "entry",
        qualified=True,
        first_at=OBSERVED,
        observed_at=OBSERVED,
        arrival_observed=internal,
        embedding=vector if vector is not None else np.array([1, 0, 0], dtype=np.float32),
    )


def request(repo: Any, count: int = 1, **changes: Any) -> dict[str, Any]:
    summary = repo.period_summary("October 2026")
    return {
        "report_id": "REP-ONE",
        "period": "October 2026",
        "now": SUBMITTED,
        "request_id": str(uuid4()),
        "expected_snapshot_version": summary["counting"]["snapshot_version"],
        "metrics": summary["metrics"],
        "payload": {
            "status": "Submitted",
            "demo": {
                "thisProvMale": str(count),
                "thisProvFemale": "0",
                "otherProvMale": "0",
                "otherProvFemale": "0",
                "foreignMale": "0",
                "foreignFemale": "0",
            },
        },
        **changes,
    }
