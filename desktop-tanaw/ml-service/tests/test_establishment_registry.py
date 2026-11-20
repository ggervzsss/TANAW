"""Shared-identity acceptance scenarios, independent of detector/model accuracy."""

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from app.identity.establishment_registry import EstablishmentRegistry
from app.identity.models import VisitorDecision
from app.storage.repositories.establishment_repository import day_bounds

NOW = datetime(2026, 11, 10, 2, tzinfo=UTC)
VECTOR = np.array([1, 0, 0], dtype=np.float32)
LATER = NOW + timedelta(minutes=5)


def observe(
    service: EstablishmentRegistry, key: str, camera: int = 1, **changes: Any
) -> VisitorDecision:
    at = changes.pop("observed_at", NOW)
    args = dict(
        observation_id=key,
        camera_id=camera,
        track_key=key,
        analysis_mode="entrance_exit" if camera == 1 else "open_space",
        kind="entry" if camera == 1 else "area_visit",
        qualified=True,
        first_at=at,
        observed_at=at,
        embedding=VECTOR,
    )
    return service.observe(**{**args, **changes})


def summary(service: EstablishmentRegistry, date: str = "2026-11-10") -> dict[str, Any]:
    start, end = (datetime.fromisoformat(value) for value in day_bounds(date))
    return service.repository.summary(start, end)


@pytest.mark.parametrize("additional,expected", [(0, 100), (15, 115)])
def test_one_hundred_door_visitors_and_forty_zone_observations(
    tmp_path: Path,
    additional: int,
    expected: int,
) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    vectors = np.eye(115, dtype=np.float32)
    for index in range(100):
        observe(service, f"door:{index}", embedding=vectors[index])
    for index in range(40 - additional):
        observe(service, f"area:{index}", 2, embedding=vectors[index], observed_at=LATER)
    for index in range(additional):
        observe(
            service, f"additional:{index}", 2, embedding=vectors[100 + index], observed_at=LATER
        )
    result = summary(service)
    assert result["unique_count"] == expected
    assert result["entries"] == 100
    assert result["exits"] == 0


def test_shared_identity_survives_restart_and_zone_revision(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    visitor = observe(service, "door")
    restored = EstablishmentRegistry(str(tmp_path), "park")
    inside = observe(restored, "area", 2, revision_id="revision-2", observed_at=LATER)
    assert visitor.visitor_id == inside.visitor_id
    assert summary(restored)["unique_count"] == 1
    with restored.database.connection() as db:
        assert db.execute("select count(*) from count_events").fetchone()[0] == 0
        assert db.execute("select count(*) from visitor_sightings").fetchone()[0] == 0


def test_repeated_observation_updates_are_idempotent(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    for _ in range(4):
        observe(service, "door")
    result = summary(service)
    assert result["unique_count"] == result["entries"] == 1
    assert result["qualified_observations"] == 1


def test_same_person_returns_after_an_observed_departure(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observe(service, "entry", track_key="person")
    observe(
        service, "exit", track_key="person", kind="exit", observed_at=NOW + timedelta(seconds=10)
    )
    observe(service, "return", track_key="return-person", observed_at=NOW + timedelta(seconds=20))
    result = summary(service)
    assert result["unique_count"] == 1
    assert result["entries"] == 2 and result["exits"] == 1
    assert result["repeat_entry_count"] == 1


def test_similar_people_in_one_view_cannot_share_an_identity(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    first = observe(service, "person-1")
    second = observe(service, "person-2")
    assert first.visitor_id != second.visitor_id
    assert summary(service)["unique_count"] == 2


def test_replaced_physical_track_can_match_when_previous_track_is_no_longer_present(
    tmp_path: Path,
) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    service.update_present_tracks(1, {"original"}, NOW)
    first = observe(service, "original")
    later = NOW + timedelta(milliseconds=500)
    service.update_present_tracks(1, {"replacement"}, later)
    replacement = observe(service, "replacement", observed_at=later)
    assert replacement.visitor_id == first.visitor_id
    assert summary(service)["unique_count"] == 1


def test_short_zone_observation_does_not_create_unique_visitor(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    decision = observe(service, "short", 2, qualified=False)
    assert decision.visitor_id is None
    assert summary(service)["unique_count"] == 0


def test_unidentified_visit_is_explicitly_unresolved(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observe(service, "no-model", 2, embedding=None)
    result = summary(service)
    assert result["unique_count"] == 0
    assert result["unresolved_observations"] == 1
    assert result["reconciliation_state"] == "partial"
    assert result["movement_state"] == "unavailable"


def test_late_appearance_enriches_original_crossing_without_creating_another_arrival(
    tmp_path: Path,
) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observe(service, "late", embedding=None)
    assert summary(service)["unresolved_observations"] == 1
    service.refresh_track(
        camera_id=1,
        track_key="late",
        observed_at=NOW + timedelta(seconds=2),
        embedding=VECTOR,
        model_name="person_reid_onnx",
    )
    result = summary(service)
    assert result["unique_count"] == result["entries"] == 1
    assert result["unresolved_observations"] == 0
    assert result["qualified_observations"] == 1


@pytest.mark.parametrize(
    "vector", [np.array([float("nan"), 0, 0]), np.array([float("inf"), 0, 0]), np.zeros(3)]
)
def test_invalid_descriptors_cannot_create_confirmed_identities(
    tmp_path: Path, vector: np.ndarray
) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observe(service, "invalid", embedding=vector)
    assert summary(service)["unique_count"] == 0
    assert summary(service)["unresolved_observations"] == 1


def test_descriptor_spaces_are_not_compared_or_claimed_reconciled(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    first = observe(service, "first", model_name="model-a")
    second = observe(service, "second", 2, model_name="model-b")
    assert first.visitor_id != second.visitor_id
    assert summary(service)["reconciliation_state"] == "partial"


def test_shape_changes_do_not_crash_identity_matching(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observe(service, "first")
    observe(service, "second", 2, embedding=np.array([1, 0, 0, 0]))
    assert summary(service)["reconciliation_state"] == "partial"


def test_enterprise_isolation(tmp_path: Path) -> None:
    first = EstablishmentRegistry(str(tmp_path), "park")
    observe(first, "first")
    second = EstablishmentRegistry(str(tmp_path), "other")
    assert summary(second)["unique_count"] == 0
    assert summary(second)["reconciliation_state"] == "not_collected"


def test_appearance_expiry_preserves_daily_summaries(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observe(service, "first")
    service.cleanup(NOW + timedelta(days=2))
    assert summary(service)["unique_count"] == 1
    assert summary(service)["days"][0]["finalized"]
    with service.database.connection() as db:
        assert db.execute("select count(*) from visitor_identities").fetchone()[0] == 0


def test_details_expire_after_thirty_days_but_summaries_remain(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observe(service, "first")
    service.cleanup(NOW + timedelta(days=31))
    with service.database.connection() as db:
        assert db.execute("select count(*) from establishment_observations").fetchone()[0] == 0
    assert summary(service)["unique_count"] == 1


def test_midnight_does_not_repeat_arrival_or_create_month_wide_identity(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    first = observe(service, "continuing")
    second = observe(service, "continuing", first_at=NOW, observed_at=NOW + timedelta(days=1))
    assert first.visitor_id != second.visitor_id
    assert summary(service)["entries"] == 1
    assert summary(service, "2026-11-11")["entries"] == 0
    assert summary(service, "2026-11-11")["unique_count"] == 1


def test_departures_can_exceed_period_arrivals(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observe(service, "departure", kind="exit")
    result = summary(service)
    assert result["exits"] == 1 and result["entries"] == 0


def test_coverage_records_zero_and_does_not_fill_an_outage(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    snapshot = {
        "occupancy": 0,
        "state": "estimated",
        "movement_available": True,
        "identification_available": True,
    }
    service.repository.checkpoint_occupancy(snapshot, NOW)
    service.repository.checkpoint_occupancy(snapshot, NOW + timedelta(seconds=2))
    service.repository.checkpoint_occupancy(snapshot, NOW + timedelta(seconds=100))
    service.repository.checkpoint_occupancy(snapshot, NOW + timedelta(seconds=102))
    result = summary(service)
    assert result["unique_count"] == 0
    assert result["peak_occupancy"] == 0
    assert result["covered_ms"] == 4000
    assert result["movement_state"] == "available"


def test_establishment_peak_uses_simultaneous_measurements(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    service.repository.checkpoint_occupancy({"occupancy": 10, "state": "estimated"}, NOW)
    service.repository.checkpoint_occupancy(
        {"occupancy": 7, "state": "estimated"}, NOW + timedelta(seconds=2)
    )
    service.repository.checkpoint_occupancy(
        {"occupancy": 7, "state": "estimated"}, NOW + timedelta(seconds=4)
    )
    assert summary(service)["peak_occupancy"] == 10


def test_late_provisional_reconciliation_updates_linked_contributions_once(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    first = observe(service, "first")
    uncertain = observe(
        service,
        "uncertain",
        2,
        observed_at=NOW + timedelta(hours=1),
        embedding=np.array([0.79, 0.613, 0]),
    )
    assert uncertain.identity_confidence == "low"
    assert summary(service)["unresolved_observations"] == 1
    resolved = observe(
        service,
        "better",
        2,
        observed_at=NOW + timedelta(hours=2),
        embedding=np.array([0.83, 0.558, 0]),
    )
    assert resolved.visitor_id == first.visitor_id
    assert summary(service)["unique_count"] == 1
    assert summary(service)["unresolved_observations"] == 0


def test_reusing_an_observation_for_another_source_rolls_back(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observe(service, "event")
    with pytest.raises(ValueError, match="reassigned"):
        observe(service, "event", 2)
    assert summary(service)["unique_count"] == 1
    assert summary(service)["qualified_observations"] == 1


def test_monthly_summary_accepts_thirty_one_day_month(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    result = service.repository.summary(
        datetime(2026, 10, 31, 16, tzinfo=UTC), datetime(2026, 11, 30, 16, tzinfo=UTC)
    )
    assert result["days_requested"] == 30
    result = service.repository.summary(
        datetime(2026, 11, 30, 16, tzinfo=UTC), datetime(2026, 12, 31, 16, tzinfo=UTC)
    )
    assert result["days_requested"] == 31


def door(
    service: EstablishmentRegistry, key: str, camera: int, kind: str, at: datetime
) -> VisitorDecision:
    """An unidentified doorway crossing, which keeps large scenarios fast."""
    return observe(
        service,
        key,
        camera,
        analysis_mode="entrance_exit",
        kind=kind,
        embedding=None,
        observed_at=at,
    )


def test_doors_share_one_establishment_balance(tmp_path: Path) -> None:
    """Visitors may enter by one door and leave by another."""
    service = EstablishmentRegistry(str(tmp_path), "park")
    for index in range(50):
        door(service, f"in:{index}", 1, "entry", NOW + timedelta(seconds=index))
    for index in range(45):
        door(service, f"out:{index}", 2, "exit", LATER + timedelta(seconds=index))
    result = summary(service)
    assert result["entries"] == 50
    assert result["exits"] == 45
    assert service.repository.today_balance(LATER + timedelta(minutes=1)) == 5
    breakdown = {item["camera_id"]: item for item in result["source_breakdown"]}
    assert (breakdown[1]["entries"], breakdown[1]["exits"]) == (50, 0)
    assert (breakdown[2]["entries"], breakdown[2]["exits"]) == (0, 45)


def test_counting_needs_no_camera_setup_beyond_the_mode(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observe(service, "door")
    observe(service, "zone", 2, embedding=np.array([0, 1, 0]), observed_at=LATER)
    result = summary(service)
    assert result["reconciliation_state"] == "estimated"
    assert result["unique_count"] == 2


def test_exit_with_nobody_inside_keeps_the_balance_at_zero(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    door(service, "early-exit", 2, "exit", NOW)
    door(service, "entry", 1, "entry", NOW + timedelta(seconds=10))
    assert service.repository.today_balance(NOW + timedelta(seconds=20)) == 1


def test_balance_starts_from_zero_each_business_day(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    for index in range(3):
        door(service, f"in:{index}", 1, "entry", NOW + timedelta(seconds=index))
    assert service.repository.today_balance(NOW + timedelta(minutes=1)) == 3
    assert service.repository.today_balance(NOW + timedelta(days=1)) == 0


def test_visitor_entering_at_one_door_and_leaving_by_another_is_one_visitor(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    entered = observe(service, "front-entry", 1)
    left = observe(
        service, "back-exit", 2, analysis_mode="entrance_exit", kind="exit", observed_at=LATER
    )
    assert entered.visitor_id == left.visitor_id
    result = summary(service)
    assert result["unique_count"] == 1
    assert result["entries"] == result["exits"] == 1


def test_person_in_view_on_another_camera_is_someone_else(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    service.update_present_tracks(1, {"front"}, NOW)
    first = observe(service, "front", 1)
    second = observe(service, "back", 2, analysis_mode="entrance_exit", kind="entry")
    assert first.visitor_id != second.visitor_id


def test_correction_sets_the_shared_balance(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    door(service, "first", 1, "entry", NOW)
    correction = service.repository.record_occupancy_correction(
        new_occupancy=10,
        reason="Ten people physically verified",
        now=NOW + timedelta(seconds=1),
    )
    door(service, "departure", 2, "exit", NOW + timedelta(seconds=2))
    assert correction["old_occupancy"] == 1
    assert service.repository.today_balance(NOW + timedelta(seconds=3)) == 9
    result = summary(service)
    assert result["entries"] == result["exits"] == 1
    assert result["unique_count"] == 0
    assert result["occupancy_corrections"][0]["reason"] == "Ten people physically verified"
