"""Hourly establishment activity used by the dashboard's insights assistant."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.analytics.establishment_hourly import hourly_activity
from app.camera.pipeline_manager import CameraPipelineRegistry
from app.identity.establishment_registry import EstablishmentRegistry
from app.main import create_app
from app.storage.repositories.establishment_repository import day_bounds

# 2026-11-10 in Asia/Manila starts at 2026-11-09T16:00Z.
DAY_START, DAY_END = (datetime.fromisoformat(value) for value in day_bounds("2026-11-10"))
MANILA_2PM = datetime(2026, 11, 10, 6, tzinfo=UTC)
NOW = datetime(2026, 11, 10, 10, tzinfo=UTC)


def row(
    first_at: datetime, mode: str = "entrance_exit", kind: str = "entry", arrival: bool = False
) -> dict[str, Any]:
    return {
        "analysis_mode": mode,
        "kind": kind,
        "arrival_observed": int(arrival),
        "first_at": first_at.isoformat(),
    }


def interval(start: datetime, end: datetime, occupancy: int | None) -> dict[str, Any]:
    return {"start_at": start.isoformat(), "end_at": end.isoformat(), "occupancy": occupancy}


def test_entries_and_area_visits_use_the_local_hour_and_the_daily_entry_rule() -> None:
    hours = hourly_activity(
        [
            row(MANILA_2PM),
            row(MANILA_2PM + timedelta(minutes=59)),
            row(MANILA_2PM + timedelta(minutes=60)),
            # An exit observation counts as an entry only when its arrival was observed.
            row(MANILA_2PM, kind="exit"),
            row(MANILA_2PM, kind="exit", arrival=True),
            row(MANILA_2PM, mode="open_space", kind="area_visit"),
            # Local midnight belongs to hour 0 of the business day.
            row(DAY_START),
            # Outside the requested range.
            row(DAY_END),
            row(DAY_START - timedelta(seconds=1)),
        ],
        [],
        DAY_START,
        DAY_END,
    )
    assert len(hours) == 24
    assert [hour["hour"] for hour in hours] == list(range(24))
    assert hours[14]["entries"] == 3
    assert hours[14]["area_visits"] == 1
    assert hours[15]["entries"] == 1
    assert hours[0]["entries"] == 1
    assert sum(hour["entries"] for hour in hours) == 5
    assert all(hour["peak_occupancy"] is None for hour in hours)


def test_occupancy_peaks_and_coverage_split_across_the_hours_an_interval_overlaps() -> None:
    hours = hourly_activity(
        [],
        [
            interval(MANILA_2PM + timedelta(minutes=30), MANILA_2PM + timedelta(hours=2), 40),
            interval(MANILA_2PM + timedelta(minutes=10), MANILA_2PM + timedelta(minutes=20), 55),
            # A zero-length checkpoint records the occupancy in the hour that contains it.
            interval(MANILA_2PM + timedelta(hours=5), MANILA_2PM + timedelta(hours=5), 7),
            interval(MANILA_2PM, MANILA_2PM + timedelta(hours=1), None),
        ],
        DAY_START,
        DAY_END,
    )
    assert hours[14]["peak_occupancy"] == 55
    assert hours[14]["covered_ms"] == 40 * 60_000
    assert hours[15]["peak_occupancy"] == 40
    assert hours[15]["covered_ms"] == 60 * 60_000
    # An interval ending exactly on the hour does not spill into the next hour.
    assert hours[16]["peak_occupancy"] is None
    assert hours[19]["peak_occupancy"] == 7
    assert hours[19]["covered_ms"] == 0


def test_intervals_are_clipped_to_the_requested_range() -> None:
    hours = hourly_activity(
        [],
        [interval(DAY_START - timedelta(hours=2), DAY_START + timedelta(minutes=30), 9)],
        DAY_START,
        DAY_END,
    )
    assert hours[0]["peak_occupancy"] == 9
    assert hours[0]["covered_ms"] == 30 * 60_000
    assert hours[22]["peak_occupancy"] is None
    assert hours[23]["peak_occupancy"] is None


def test_several_days_add_up_by_hour_of_day(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    vectors = np.eye(3, dtype=np.float32)
    for index, at in enumerate((MANILA_2PM, MANILA_2PM - timedelta(days=1), NOW)):
        service.observe(
            observation_id=f"door:{index}",
            camera_id=1,
            track_key=f"door:{index}",
            analysis_mode="entrance_exit",
            kind="entry",
            qualified=True,
            first_at=at,
            observed_at=at,
            embedding=vectors[index],
        )
    service.repository.checkpoint_occupancy({"occupancy": 4, "state": "estimated"}, MANILA_2PM)
    start = datetime.fromisoformat(day_bounds("2026-11-09")[0])
    result = service.repository.hourly(start, DAY_END, now=NOW)
    assert result["enterprise_id"] == "park"
    assert result["days_requested"] == 2
    assert result["days_retained"] == 2
    assert result["state"] == "available"
    assert result["hours"][14]["entries"] == 2
    assert result["hours"][14]["peak_occupancy"] == 4
    assert result["hours"][18]["entries"] == 1


def test_state_reports_nothing_observed_and_days_beyond_retention(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    assert service.repository.hourly(DAY_START, DAY_END, now=NOW)["state"] == "unavailable"
    service.repository.checkpoint_occupancy({"occupancy": 2, "state": "estimated"}, MANILA_2PM)
    start = DAY_START - timedelta(days=30)
    result = service.repository.hourly(start, DAY_END, now=NOW)
    assert result["days_requested"] == 31
    assert result["days_retained"] == 31
    assert result["state"] == "available"
    later = service.repository.hourly(start, DAY_END, now=NOW + timedelta(days=1))
    assert later["days_retained"] == 30
    assert later["state"] == "partial"


@pytest.mark.parametrize(
    "start,end",
    [
        (DAY_END, DAY_START),
        (DAY_START, DAY_START),
        (DAY_START + timedelta(hours=1), DAY_END),
        (DAY_START - timedelta(days=31), DAY_END),
    ],
)
def test_ranges_must_be_increasing_local_midnights_of_at_most_31_days(
    tmp_path: Path, start: datetime, end: datetime
) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    with pytest.raises(ValueError):
        service.repository.hourly(start, end, now=NOW)


def test_hourly_api_returns_24_hours_for_the_bound_enterprise_only(tmp_path: Path) -> None:
    pipelines = CameraPipelineRegistry(str(tmp_path))
    pipelines.bind_enterprise("park")
    pipelines.establishment_repository().checkpoint_occupancy(
        {"occupancy": 6, "state": "estimated"}, datetime.now(UTC)
    )
    client = TestClient(create_app(pipelines))
    today = datetime.now(UTC).astimezone(DAY_START.tzinfo)
    start, end = (datetime.fromisoformat(value) for value in day_bounds(today.date().isoformat()))
    params = {"start": start.isoformat(), "end": end.isoformat()}
    try:
        response = client.get("/metrics/establishment/hourly", params=params)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["enterprise_id"] == "park"
        assert len(data["hours"]) == 24
        assert max(hour["peak_occupancy"] or 0 for hour in data["hours"]) == 6
        assert set(data["hours"][0]) == {
            "hour",
            "entries",
            "area_visits",
            "peak_occupancy",
            "covered_ms",
        }
        assert (
            client.get(
                "/metrics/establishment/hourly",
                params={"start": end.isoformat(), "end": start.isoformat()},
            ).status_code
            == 422
        )
        assert client.get("/metrics/establishment/hourly").status_code == 422
        pipelines.bind_enterprise("other")
        other = client.get("/metrics/establishment/hourly", params=params).json()
        assert other["enterprise_id"] == "other"
        assert other["state"] == "unavailable"
    finally:
        pipelines.close()
