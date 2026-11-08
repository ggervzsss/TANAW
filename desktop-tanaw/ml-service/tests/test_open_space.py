from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.analytics.open_space import AreaVisitTracker
from app.config.open_space_config import OpenSpaceConfig
from app.storage.local_database import LocalDatabase
from app.storage.repositories.area_repository import AreaRepository

POLYGON = [{"x": 0.2, "y": 0.2}, {"x": 0.8, "y": 0.2}, {"x": 0.8, "y": 0.8}, {"x": 0.2, "y": 0.8}]


def engine() -> AreaVisitTracker:
    return AreaVisitTracker(
        OpenSpaceConfig.model_validate({"polygon": POLYGON}),
        wall_anchor=datetime(2026, 1, 1, tzinfo=UTC),
    )


def completed(t: AreaVisitTracker) -> list[dict]:
    for at, point in [
        (0, (0.1, 0.5)),
        (1, (0.5, 0.5)),
        (2, (0.5, 0.5)),
        (3, (0.5, 0.5)),
        (4, (0.5, 0.5)),
        (5, (0.9, 0.5)),
        (6, (0.9, 0.5)),
    ]:
        t.update({1: point}, at)
    return t.drain()


def test_complete_visit_uses_inside_times_not_exit_confirmation() -> None:
    rows = completed(engine())
    assert len(rows) == 1
    assert rows[0]["status"] == "completed"
    assert rows[0]["estimated_dwell_ms"] == 3000


def test_inside_birth_is_incomplete_even_with_observed_departure() -> None:
    t = engine()
    for at in range(4):
        t.update({1: (0.5, 0.5)}, float(at))
    t.update({1: (0.9, 0.5)}, 4)
    t.update({1: (0.9, 0.5)}, 5)
    assert t.drain()[0]["status"] == "incomplete"


def test_missing_track_does_not_extend_duration() -> None:
    t = engine()
    for at in range(4):
        t.update({1: (0.5, 0.5)}, float(at))
    t.tick(10)
    row = t.drain()[0]
    assert row["estimated_dwell_ms"] == 3000
    assert row["termination_reason"] == "track_lost"


def test_duplicate_and_old_frames_cannot_advance_observations() -> None:
    t = engine()
    assert t.update({1: (0.5, 0.5)}, 1)
    assert not t.update({1: (0.5, 0.5)}, 1)
    assert not t.update({1: (0.5, 0.5)}, 0)
    assert not t.active_records()


def test_gap_and_restart_never_create_false_completion() -> None:
    t = engine()
    t.update({1: (0.1, 0.5)}, 0)
    for at in range(1, 5):
        t.update({1: (0.5, 0.5)}, float(at))
    t.update({}, 4.5)
    assert t.snapshot()["presence"] == 0
    assert t.snapshot()["temporarily_missing"] == 1
    t.update({1: (0.5, 0.5)}, 5)
    assert t.active_records()[0]["uncertain_gap_count"] == 1
    t.interrupt(7, "camera_stopped")
    assert t.snapshot()["presence"] is None
    assert t.drain()[0]["status"] == "incomplete"


@pytest.mark.parametrize(
    "points",
    [
        POLYGON[:2],
        [{"x": float("nan"), "y": 0.2}, *POLYGON[1:]],
        [POLYGON[0], POLYGON[2], POLYGON[1], POLYGON[3]],
        [POLYGON[0]] * 4,
    ],
)
def test_invalid_zones_are_rejected(points: list) -> None:
    with pytest.raises(ValueError):
        OpenSpaceConfig(polygon=points)


def test_storage_terminal_retry_recovery_and_enterprise_isolation(tmp_path: Path) -> None:
    db = LocalDatabase(str(tmp_path), "one")
    repo = AreaRepository(db)
    t = engine()
    repo.start("run", 1, "Park", t.config.model_dump(mode="json"), t.timestamp(0))
    row = completed(t)[0]
    for _ in range(2):
        repo.checkpoint("run", [], [row], t.snapshot(), t.timestamp(6))
    start = datetime(2026, 1, 1, tzinfo=UTC)
    result = repo.query(1, start, start + timedelta(hours=1))
    assert result["completed_count"] == 1
    assert result["median_dwell_ms"] == 3000
    with db.connection() as connection:
        assert (
            connection.execute("select sum(completed_count) from area_hourly_rollups").fetchone()[0]
            == 1
        )
        assert connection.execute("select count(*) from count_events").fetchone()[0] == 0
    other = AreaRepository(LocalDatabase(str(tmp_path), "two"))
    assert other.query(1, start, start + timedelta(hours=1))["observed_visits"] == 0
    # A new active record with an unknown endpoint is recovered, never resumed.
    t = engine()
    for at in range(4):
        t.update({2: (0.5, 0.5)}, at)
    repo.checkpoint("run", t.active_records(), [], t.snapshot(), t.timestamp(7))
    repo.recover()
    result = repo.query(1, start, start + timedelta(hours=1))
    assert result["completed_count"] == 1 and result["incomplete_count"] == 1


def test_coverage_distinguishes_empty_from_outage(tmp_path: Path) -> None:
    repo = AreaRepository(LocalDatabase(str(tmp_path), "one"))
    t = engine()
    repo.start("run", 1, "Park", t.config.model_dump(mode="json"), t.timestamp(0))
    t.update({}, 0)
    repo.checkpoint("run", [], [], t.snapshot(), t.timestamp(0))
    t.update({}, 10)
    repo.checkpoint("run", [], [], t.snapshot(), t.timestamp(10))
    t.interrupt(10, "stream_interrupted")
    repo.checkpoint("run", [], [], t.snapshot(), t.timestamp(10))
    t.update({}, 100)
    repo.checkpoint("run", [], [], t.snapshot(), t.timestamp(100))
    t.update({}, 110)
    repo.checkpoint("run", [], [], t.snapshot(), t.timestamp(110))
    start = datetime(2026, 1, 1, tzinfo=UTC)
    result = repo.query(1, start, start + timedelta(seconds=120))
    assert result["covered_ms"] == 20_000
    assert result["peak_presence"] == 0
    assert result["median_dwell_ms"] is None


def test_two_independent_people_and_reentry_have_independent_durations() -> None:
    t = engine()
    t.update({1: (0.1, 0.5), 2: (0.1, 0.6)}, 0)
    for at in range(1, 5):
        t.update({1: (0.5, 0.5), 2: (0.6, 0.6)}, at)
    t.update({1: (0.9, 0.5), 2: (0.6, 0.6)}, 5)
    t.update({1: (0.9, 0.5), 2: (0.6, 0.6)}, 6)
    first = t.drain()
    assert len(first) == 1 and first[0]["estimated_dwell_ms"] == 3000
    assert len(t.active_records()) == 1
    for at in range(7, 10):
        t.update({1: (0.5, 0.5), 2: (0.6, 0.6)}, at)
    t.update({1: (0.9, 0.5), 2: (0.9, 0.6)}, 10)
    t.update({1: (0.9, 0.5), 2: (0.9, 0.6)}, 11)
    rows = t.drain()
    assert len(rows) == 2
    assert len({v["visit_id"] for v in [*first, *rows]}) == 3
    assert sorted(v["estimated_dwell_ms"] for v in rows) == [2000, 8000]


def test_cross_midnight_visit_uses_completion_cohort_and_exact_even_median(tmp_path: Path) -> None:
    start = datetime(2026, 1, 1, 23, 59, 57, tzinfo=UTC)
    repo = AreaRepository(LocalDatabase(str(tmp_path), "one"))
    t = AreaVisitTracker(OpenSpaceConfig.model_validate({"polygon": POLYGON}), wall_anchor=start)
    repo.start("run", 1, "Park", t.config.model_dump(mode="json"), t.timestamp(0))
    row = completed(t)[0]
    repo.checkpoint("run", [], [row], t.snapshot(), t.timestamp(6))
    before = repo.query(1, start, start.replace(day=2, hour=0, minute=0, second=0))
    after = repo.query(
        1, start.replace(day=2, hour=0, minute=0, second=0), start + timedelta(hours=1)
    )
    assert before["completed_count"] == 0 and after["completed_count"] == 1
    assert sum(h["completed_count"] for h in after["history"]) == 1
    second = {**row, "visit_id": "second", "estimated_dwell_ms": 5000}
    repo.checkpoint("run", [], [second], t.snapshot(), t.timestamp(6))
    result = repo.query(1, start, start + timedelta(hours=1), limit=1)
    assert result["median_dwell_ms"] == 4000
    assert result["average_dwell_ms"] == 4000
    assert result["total_records"] == 2 and len(result["visits"]) == 1


def test_retention_keeps_rollups_and_active_visits(tmp_path: Path) -> None:
    repo = AreaRepository(LocalDatabase(str(tmp_path), "one"))
    t = engine()
    repo.start("run", 1, "Park", t.config.model_dump(mode="json"), t.timestamp(0))
    row = completed(t)[0]
    repo.checkpoint("run", [], [row], t.snapshot(), t.timestamp(6))
    later = engine()
    for at in range(4):
        later.update({2: (0.5, 0.5)}, at)
    repo.checkpoint("run", later.active_records(), [], later.snapshot(), t.timestamp(7))
    repo.cleanup(datetime(2026, 2, 15, tzinfo=UTC))
    with repo.database.connection() as db:
        assert (
            db.execute("select count(*) from area_visits where status='active'").fetchone()[0] == 1
        )
        assert (
            db.execute("select count(*) from area_visits where status='completed'").fetchone()[0]
            == 0
        )
        assert db.execute("select sum(completed_count) from area_hourly_rollups").fetchone()[0] == 1


def test_terminal_visit_and_rollup_roll_back_together_before_retry(tmp_path: Path) -> None:
    from unittest.mock import patch

    repo = AreaRepository(LocalDatabase(str(tmp_path), "one"))
    t = engine()
    repo.start("run", 1, "Park", t.config.model_dump(mode="json"), t.timestamp(0))
    record = completed(t)[0]
    with patch.object(repo, "_ensure_bucket", side_effect=RuntimeError("Injected write failure")):
        with pytest.raises(RuntimeError):
            repo.checkpoint("run", [], [record], t.snapshot(), t.timestamp(6))
    with repo.database.connection() as db:
        assert db.execute("select count(*) from area_visits").fetchone()[0] == 0
        assert db.execute("select count(*) from area_hourly_rollups").fetchone()[0] == 0
    repo.checkpoint("run", [], [record], t.snapshot(), t.timestamp(6))
    repo.checkpoint("run", [], [record], t.snapshot(), t.timestamp(6))
    with repo.database.connection() as db:
        assert db.execute("select sum(completed_count) from area_hourly_rollups").fetchone()[0] == 1


def test_clock_correction_does_not_double_count_coverage(tmp_path: Path) -> None:
    repo = AreaRepository(LocalDatabase(str(tmp_path), "one"))
    t = engine()
    config = t.config.model_dump(mode="json")
    for run, first, last in [("before_clock_change", 0, 60), ("after_clock_change", 30, 90)]:
        repo.start(run, 1, "Park", config, t.timestamp(first))
        snapshot = {"available": True, "presence": 1, "temporarily_missing": 0}
        repo.checkpoint(run, [], [], snapshot, t.timestamp(first))
        repo.checkpoint(run, [], [], snapshot, t.timestamp(last))
        repo.end(run, "clock_discontinuity", t.timestamp(last))
    start = datetime(2026, 1, 1, tzinfo=UTC)
    result = repo.query(1, start, start + timedelta(seconds=120))
    assert result["covered_ms"] == 90_000
    assert result["coverage_ratio"] == 0.75
    assert sum(hour["covered_ms"] for hour in result["history"]) == 90_000
