import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

from app.camera.pipeline_manager import CameraPipelineRegistry
from app.identity.establishment_registry import EstablishmentRegistry
from app.main import create_app
from app.storage.repositories.establishment_report_repository import EstablishmentReportRepository
from app.storage.repositories.establishment_repository import timestamp
from app.storage.repositories.establishment_sample_repository import (
    SAMPLE_SOURCE_NAME,
    prepare_sample_period,
)

NOW = datetime(2026, 11, 16, 4, tzinfo=UTC)
COUNTS = {"entries": 120, "exits": 108, "unique_count": 90}


def prepare(service: EstablishmentRegistry, period: str, report_id: str = "SAMPLE-REP-1"):
    return prepare_sample_period(
        service.repository, report_id=report_id, period=period, now=NOW, **COUNTS
    )


def test_completed_month_matches_prepared_totals_and_is_report_ready(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")

    assert prepare(service, "October 2026") == {
        "period": "October 2026",
        "prepared": True,
        "days": 31,
    }

    summary = EstablishmentReportRepository(service.database).period_summary("October 2026")
    assert summary["metrics"]["entries"] == 120
    assert summary["metrics"]["exits"] == 108
    assert summary["metrics"]["unique_count"] == 90
    assert summary["metrics"]["peak_occupancy"] >= 1
    counting = summary["counting"]
    assert counting["reconciliation_state"] == "estimated"
    assert counting["movement_state"] == "available"
    assert counting["identification_state"] == "available"
    assert counting["coverage_ratio"] > 0
    assert [source["camera_name"] for source in counting["source_breakdown"]] == [
        SAMPLE_SOURCE_NAME
    ]
    with service.database.connection() as db:
        assert {
            row[0] for row in db.execute("select finalized from establishment_daily_summaries")
        } == {1}


def test_preparation_is_idempotent_and_deterministic(tmp_path: Path):
    first = EstablishmentRegistry(str(tmp_path / "first"), "park")
    second = EstablishmentRegistry(str(tmp_path / "second"), "park")
    prepare(first, "September 2026")
    prepare(second, "September 2026")

    assert prepare(first, "September 2026") == {
        "period": "September 2026",
        "prepared": False,
        "days": 0,
    }
    first_summary = EstablishmentReportRepository(first.database).period_summary("September 2026")
    second_summary = EstablishmentReportRepository(second.database).period_summary("September 2026")
    assert first_summary["metrics"] == second_summary["metrics"]
    assert first_summary["metrics"]["unique_count"] == 90


def today_summary(service: EstablishmentRegistry) -> tuple[dict, int]:
    with service.database.connection() as db:
        row = db.execute(
            "select metrics_json,finalized from establishment_daily_summaries "
            "where business_date='2026-11-16'"
        ).fetchone()
    return json.loads(row[0]), row[1]


def test_current_month_includes_today_up_to_now_and_keeps_up(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")

    assert prepare(service, "November 2026")["days"] == 16
    midday, finalized = today_summary(service)
    assert finalized == 0
    assert midday["qualified_observations"] > 0
    assert midday["last_event_at"] <= timestamp(NOW)

    later = prepare_sample_period(
        service.repository,
        report_id="SAMPLE-REP-1",
        period="November 2026",
        now=NOW + timedelta(hours=6),
        **COUNTS,
    )
    evening, _ = today_summary(service)
    assert later["days"] == 1
    assert evening["qualified_observations"] > midday["qualified_observations"]
    assert evening["entries"] >= midday["entries"]


def test_sample_day_closed_mid_day_is_completed_on_the_next_day(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")
    prepare(service, "November 2026")
    partial, _ = today_summary(service)
    service.repository.cleanup(NOW + timedelta(days=1))
    assert today_summary(service)[1] == 1

    prepare_sample_period(
        service.repository,
        report_id="SAMPLE-REP-1",
        period="November 2026",
        now=NOW + timedelta(days=1),
        **COUNTS,
    )
    complete, finalized = today_summary(service)
    assert finalized == 1
    assert complete["qualified_observations"] > partial["qualified_observations"]


def test_camera_activity_today_replaces_sample_visits(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")
    prepare(service, "November 2026")
    service.observe(
        observation_id="camera-today",
        camera_id=1,
        track_key="person",
        analysis_mode="entrance_exit",
        kind="entry",
        qualified=True,
        first_at=NOW,
        observed_at=NOW,
        embedding=np.array([1, 0, 0], dtype=np.float32),
    )

    assert prepare(service, "November 2026")["days"] == 0
    today, _ = today_summary(service)
    assert today["sources"] == [1]
    assert today["unique_count"] == 1
    assert today["reconciliation_state"] == "estimated"


def test_days_with_camera_data_and_submitted_periods_are_left_alone(tmp_path: Path):
    service = EstablishmentRegistry(str(tmp_path), "park")
    observed = datetime(2026, 10, 10, 2, tzinfo=UTC)
    service.observe(
        observation_id="camera-visit",
        camera_id=1,
        track_key="person",
        analysis_mode="entrance_exit",
        kind="entry",
        qualified=True,
        first_at=observed,
        observed_at=observed,
        embedding=np.array([1, 0, 0], dtype=np.float32),
    )

    assert prepare(service, "October 2026")["days"] == 30
    with service.database.connection() as db:
        camera_day = json.loads(
            db.execute(
                "select metrics_json from establishment_daily_summaries where business_date=?",
                ("2026-10-10",),
            ).fetchone()[0]
        )
        db.execute(
            "insert into report_submissions (report_id,submission_id,period,submitted_at,"
            "entries,exits,peak_occupancy,unique_count,notes,payload_json,sync_status) "
            "values ('REP-SEP','sub','September 2026','2026-10-02T00:00:00+00:00',"
            "0,0,0,0,'','{}','pending_cloud_sync')"
        )
    assert camera_day["unique_count"] == 1
    assert [source["camera_id"] for source in camera_day["source_breakdown"]] == [1]
    assert prepare(service, "September 2026")["days"] == 0


def test_sample_population_does_not_change_live_enterprise_occupancy(tmp_path: Path):
    pipelines = CameraPipelineRegistry(str(tmp_path))
    pipelines.bind_enterprise("park")
    try:
        pipelines.prepare_sample_counts(
            enterprise_id="park",
            enterprise_name="Park",
            report_id="SAMPLE-REP-1",
            period="October 2026",
            **COUNTS,
        )
        assert pipelines.camera_states()["enterprise_occupancy"] == 0
    finally:
        pipelines.close()


def test_sample_api_prepares_counts_that_can_be_submitted(tmp_path: Path):
    pipelines = CameraPipelineRegistry(str(tmp_path))
    pipelines.bind_enterprise("park", "Park")
    client = TestClient(create_app(pipelines))
    body = {
        "report_id": "SAMPLE-REP-1",
        "enterprise_id": "park",
        "enterprise_name": "Park",
        "period": "October 2026",
        **COUNTS,
    }
    try:
        rejected = client.post("/sample/prepare", json={**body, "enterprise_id": "other"})
        assert rejected.status_code == 400
        assert "Desktop is bound to park" in rejected.json()["detail"]

        prepared = client.post("/sample/prepare", json=body)
        assert prepared.status_code == 200, prepared.text
        assert prepared.json() == {
            "enterprise_id": "park",
            "enterprise_name": "Park",
            "period": "October 2026",
            "prepared": True,
            "days": 31,
        }

        period = client.get("/metrics/establishment/periods").json()[0]
        submitted = client.post(
            "/reports/local-submit",
            json={
                "request_id": "8f0c8d55-8a3e-4a55-9a49-8d7c1f2ad7f1",
                "report_id": "REP-OCT",
                "period": "October 2026",
                "expected_snapshot_version": period["counting"]["snapshot_version"],
                "metrics": period["metrics"],
                "payload": {
                    "status": "Submitted",
                    "demo": {
                        "thisProvMale": "50",
                        "thisProvFemale": "40",
                        "otherProvMale": "0",
                        "otherProvFemale": "0",
                        "foreignMale": "0",
                        "foreignFemale": "0",
                    },
                },
            },
        )
        assert submitted.status_code == 200, submitted.text
        assert submitted.json()["unique_count"] == 90
    finally:
        pipelines.close()
