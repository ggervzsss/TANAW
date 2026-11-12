from datetime import UTC, datetime
from pathlib import Path
from threading import Event
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.camera.pipeline_manager import CameraPipelineRegistry
from app.config.camera_coverage import CameraCoverage
from app.main import create_app


def test_summary_api_supports_months_and_validates_local_calendar_boundaries(tmp_path: Path):
    pipelines = CameraPipelineRegistry(str(tmp_path))
    pipelines.bind_enterprise("park")
    client = TestClient(create_app(pipelines))
    try:
        response = client.get(
            "/metrics/establishment/summary",
            params={
                "start": "2026-11-30T16:00:00+00:00",
                "end": "2026-12-31T16:00:00+00:00",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["days_requested"] == 31
        assert data["reconciliation_state"] == "not_collected"
        assert len(data["snapshot_version"]) == 64
        assert (
            client.get("/metrics/establishment/summary", params={"period": "December 2026"}).json()[
                "days_requested"
            ]
            == 31
        )
        assert (
            client.get(
                "/metrics/establishment/summary",
                params={"period": "December 2026", "start": "2026-12-01T00:00:00+08:00"},
            ).status_code
            == 422
        )
        assert (
            client.get(
                "/metrics/establishment/summary",
                params={
                    "start": "2026-12-01T01:00:00+00:00",
                    "end": "2026-12-02T01:00:00+00:00",
                },
            ).status_code
            == 422
        )
        assert (
            client.get(
                "/metrics/establishment/summary",
                params={
                    "start": "2026-12-01T00:00:00",
                    "end": "2026-12-02T00:00:00",
                },
            ).status_code
            == 422
        )
    finally:
        pipelines.close()


def test_summary_api_uses_only_the_bound_enterprises_shared_ledger(tmp_path: Path):
    pipelines = CameraPipelineRegistry(str(tmp_path))
    pipelines.bind_enterprise("park")
    service = pipelines._establishment_registry
    assert service is not None
    now = datetime(2026, 11, 10, 2, tzinfo=UTC)
    service.observe(
        observation_id="area",
        camera_id=2,
        track_key="person",
        analysis_mode="open_space",
        kind="area_visit",
        coverage=CameraCoverage(role="internal_observation", relationship="independent"),
        qualified=True,
        first_at=now,
        observed_at=now,
    )
    client = TestClient(create_app(pipelines))
    params = {"start": "2026-11-09T16:00:00+00:00", "end": "2026-11-10T16:00:00+00:00"}
    try:
        response = client.get("/metrics/establishment/summary", params=params)
        assert response.json()["unresolved_observations"] == 1
        pipelines.bind_enterprise("other")
        assert client.get("/metrics/establishment/summary", params=params).json()["days"] == []
    finally:
        pipelines.close()


def test_summaries_are_checkpointed_without_dashboard_requests_and_worker_closes(tmp_path: Path):
    pipelines = CameraPipelineRegistry(str(tmp_path))
    pipelines.bind_enterprise("park")
    checkpointed = Event()
    repository = pipelines.establishment_repository()
    original = repository.checkpoint_occupancy

    def checkpoint(snapshot, now):
        original(snapshot, now)
        checkpointed.set()

    try:
        with (
            patch.object(
                pipelines, "establishment_live", return_value={"occupancy": 3, "state": "estimated"}
            ),
            patch.object(repository, "checkpoint_occupancy", side_effect=checkpoint),
        ):
            pipelines._start_summary_worker()
            assert checkpointed.wait(timeout=5)
        with repository.database.connection() as db:
            assert (
                db.execute("select count(*) from establishment_daily_summaries").fetchone()[0] == 1
            )
    finally:
        pipelines.close()
    assert pipelines._summary_thread is not None
    assert not pipelines._summary_thread.is_alive()


def test_normal_report_api_freezes_open_space_counts_and_replays_one_submission(tmp_path: Path):
    import numpy as np

    pipelines = CameraPipelineRegistry(str(tmp_path))
    pipelines.bind_enterprise("park")
    service = pipelines._establishment_registry
    assert service is not None
    now = datetime(2026, 10, 10, 2, tzinfo=UTC)
    service.observe(
        observation_id="area-one",
        camera_id=1,
        track_key="person",
        analysis_mode="open_space",
        kind="area_visit",
        coverage=CameraCoverage(role="internal_observation", relationship="independent"),
        qualified=True,
        first_at=now,
        observed_at=now,
        embedding=np.array([1, 0, 0], dtype=np.float32),
    )
    client = TestClient(create_app(pipelines))
    try:
        periods = client.get("/metrics/establishment/periods").json()
        assert [item["period"] for item in periods] == ["October 2026"]
        counts = periods[0]
        body = {
            "request_id": "26ae7461-d994-48f4-932d-c7b9e5106217",
            "report_id": "REP-ONE",
            "period": "October 2026",
            "expected_snapshot_version": counts["counting"]["snapshot_version"],
            "metrics": counts["metrics"],
            "payload": {
                "status": "Submitted",
                "demo": {
                    "thisProvMale": "1",
                    "thisProvFemale": "",
                    "otherProvMale": "",
                    "otherProvFemale": "",
                    "foreignMale": "",
                    "foreignFemale": "",
                },
            },
        }
        first = client.post("/reports/local-submit", json=body)
        assert first.status_code == 200, first.text
        assert (
            first.json()["entries"]
            is first.json()["exits"]
            is first.json()["peak_occupancy"]
            is None
        )
        assert first.json()["unique_count"] == 1
        assert (
            first.json()["payload"]["counting"]["snapshot_version"]
            == counts["counting"]["snapshot_version"]
        )
        assert client.post("/reports/local-submit", json=body).json() == first.json()
        saved = client.get("/reports/local").json()
        assert len(saved) == 1
        assert saved[0]["payload"]["counting"] == counts["counting"]
        pipelines.bind_enterprise("other")
        assert client.get("/reports/local").json() == []
        assert client.get("/metrics/establishment/periods").json() == []
    finally:
        pipelines.close()
