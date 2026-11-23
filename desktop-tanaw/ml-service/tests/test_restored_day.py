from typing import Any

from app.analytics.restored_day import RESTORED_BASELINE_KEY, merge_restored_day


def day(**values: Any) -> dict[str, Any]:
    metrics: dict[str, Any] = {
        "business_date": "2026-11-16",
        "unique_count": 0,
        "confirmed_unique_count": 0,
        "entries": 0,
        "exits": 0,
        "repeat_entry_count": 0,
        "unresolved_observations": 0,
        "qualified_observations": 0,
        "covered_ms": 0,
        "coverage_ratio": 0.0,
        "peak_occupancy": None,
        "occupancy_corrections": [],
        "first_event_at": None,
        "last_event_at": None,
        "sources": [],
        "source_breakdown": [],
        "movement_state": "unavailable",
        "identification_state": "unavailable",
        "reconciliation_state": "estimated",
        "incompatible_identity_models": False,
        "identification_coverage": None,
        "male_count": 0,
        "female_count": 0,
        "sex_estimation_state": "estimated",
        "sex_evidence_share": None,
        "sex_models": [],
    }
    metrics.update(values)
    return metrics


def source(camera_id: int, **values: Any) -> dict[str, Any]:
    return {
        "camera_id": camera_id,
        "camera_name": f"Camera {camera_id}",
        "analysis_modes": ["entrance_exit"],
        "entries": 0,
        "exits": 0,
        "unique_count": 0,
        "qualified_observations": 0,
        "configuration_revisions": [],
        "embedding_spaces": [],
        "identity_confidence": {},
        "matching_decisions": {},
        **values,
    }


BASELINE = day(
    unique_count=40,
    confirmed_unique_count=40,
    entries=50,
    exits=30,
    qualified_observations=80,
    covered_ms=14_400_000,
    peak_occupancy=22,
    first_event_at="2026-11-15T23:05:00.000Z",
    last_event_at="2026-11-16T03:55:00.000Z",
    sources=[1],
    source_breakdown=[source(1, entries=50, exits=30, unique_count=40, qualified_observations=80)],
    movement_state="available",
    identification_state="available",
    male_count=18,
    female_count=22,
    sex_evidence_share=0.5,
    sex_models=["quality"],
)


def test_a_day_without_new_activity_shows_the_restored_totals() -> None:
    merged = merge_restored_day(day(), BASELINE)

    assert merged["entries"] == 50
    assert merged["unique_count"] == 40
    assert merged[RESTORED_BASELINE_KEY] == BASELINE


def test_new_activity_is_added_to_the_restored_totals() -> None:
    computed = day(
        unique_count=10,
        confirmed_unique_count=10,
        entries=12,
        exits=20,
        qualified_observations=22,
        covered_ms=3_600_000,
        peak_occupancy=30,
        first_event_at="2026-11-16T05:00:00.000Z",
        last_event_at="2026-11-16T06:00:00.000Z",
        sources=[1, 2],
        source_breakdown=[
            source(1, entries=10, exits=18, unique_count=8, qualified_observations=18),
            source(2, entries=2, exits=2, unique_count=2, qualified_observations=4),
        ],
        movement_state="available",
        identification_state="available",
        male_count=4,
        female_count=6,
        sex_evidence_share=1.0,
        sex_models=["quality"],
    )

    merged = merge_restored_day(computed, BASELINE)

    assert merged["entries"] == 62
    assert merged["exits"] == 50
    assert merged["unique_count"] == 50
    assert merged["qualified_observations"] == 102
    assert merged["covered_ms"] == 18_000_000
    assert merged["coverage_ratio"] == 18_000_000 / 86_400_000
    assert merged["peak_occupancy"] == 30
    assert merged["first_event_at"] == "2026-11-15T23:05:00.000Z"
    assert merged["last_event_at"] == "2026-11-16T06:00:00.000Z"
    assert merged["sources"] == [1, 2]
    assert [
        (item["camera_id"], item["entries"], item["unique_count"])
        for item in merged["source_breakdown"]
    ] == [(1, 60, 48), (2, 2, 2)]
    assert (merged["male_count"], merged["female_count"]) == (22, 28)
    assert merged["sex_estimation_state"] == "estimated"
    assert merged["sex_evidence_share"] == (0.5 * 40 + 1.0 * 10) / 50
    assert merged[RESTORED_BASELINE_KEY] == BASELINE


def test_a_nested_baseline_is_never_carried_twice() -> None:
    nested = {**BASELINE, RESTORED_BASELINE_KEY: {"entries": 999}}

    merged = merge_restored_day(day(entries=1, qualified_observations=1), nested)

    assert merged["entries"] == 51
    assert RESTORED_BASELINE_KEY not in merged[RESTORED_BASELINE_KEY]


def test_missing_sex_estimates_on_either_side_leave_the_day_unestimated() -> None:
    computed = day(
        unique_count=5,
        qualified_observations=5,
        male_count=None,
        female_count=None,
        sex_estimation_state="unavailable",
    )

    merged = merge_restored_day(computed, BASELINE)

    assert merged["male_count"] is None
    assert merged["female_count"] is None
    assert merged["sex_estimation_state"] == "unavailable"
