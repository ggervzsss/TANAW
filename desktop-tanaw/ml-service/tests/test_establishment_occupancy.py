from typing import Literal

from app.analytics.establishment_occupancy import OccupancyMeasurement, reconcile_occupancy
from app.config.camera_coverage import CameraCoverage


def measurement(
    camera_id: int,
    count: int | None,
    *,
    relationship: Literal[
        "unknown", "independent", "contained", "overlapping", "alternative"
    ] = "independent",
    related=None,
    people=(),
    boundary=False,
):
    return OccupancyMeasurement(
        camera_id,
        CameraCoverage(
            role="external_boundary" if boundary else "internal_observation",
            relationship=relationship,
            related_camera_id=related,
        ),
        count is not None,
        count,
        frozenset(people),
        boundary,
    )


def test_inside_zone_is_not_added_to_parent_occupancy():
    result = reconcile_occupancy(
        [
            measurement(1, 100, boundary=True),
            measurement(2, 40, relationship="contained", related=1),
        ]
    )
    assert result["occupancy"] == 100
    assert result["excluded_camera_ids"] == [2]


def test_unavailable_contained_zone_does_not_invalidate_available_parent():
    result = reconcile_occupancy(
        [
            measurement(1, 100, boundary=True),
            measurement(2, None, relationship="contained", related=1),
        ]
    )
    assert result["occupancy"] == 100
    assert result["state"] == "estimated"


def test_independent_current_populations_are_added():
    assert reconcile_occupancy([measurement(1, 10), measurement(2, 5)])["occupancy"] == 15


def test_overlapping_views_use_union_of_known_people():
    result = reconcile_occupancy(
        [
            measurement(1, 3, people=("a", "b", "c")),
            measurement(2, 3, relationship="overlapping", related=1, people=("b", "c", "d")),
        ]
    )
    assert result["occupancy"] == 4
    assert result["state"] == "estimated"


def test_overlap_chain_does_not_assume_all_views_are_identical():
    result = reconcile_occupancy(
        [
            measurement(1, 2, people=("a", "b")),
            measurement(2, 2, relationship="overlapping", related=1, people=("b", "c")),
            measurement(3, 2, relationship="overlapping", related=2, people=("c", "d")),
        ]
    )
    assert result["occupancy"] == 4


def test_unresolved_overlap_is_a_disclosed_lower_bound():
    result = reconcile_occupancy(
        [
            measurement(1, 3, people=("a",)),
            measurement(2, 3, relationship="overlapping", related=1, people=("b",)),
        ]
    )
    assert result["occupancy"] == 3
    assert result["state"] == "partial"


def test_unavailable_essential_measurement_withholds_whole_total():
    result = reconcile_occupancy([measurement(1, 10), measurement(2, None)])
    assert result["occupancy"] is None
    assert result["partial_occupancy"] == 10
    assert result["missing_camera_ids"] == [2]


def test_contained_zone_cannot_stand_in_for_missing_whole_population():
    result = reconcile_occupancy(
        [
            measurement(1, None, boundary=True),
            measurement(2, 5, relationship="contained", related=1),
        ]
    )
    assert result["occupancy"] is None
    assert result["state"] == "unavailable"


def test_explicit_backup_can_replace_unavailable_primary():
    result = reconcile_occupancy(
        [
            measurement(1, None, boundary=True),
            measurement(2, 5, relationship="alternative", related=1),
        ]
    )
    assert result["occupancy"] == 5
    assert result["contributions"][0]["camera_ids"] == [2]


def test_backup_does_not_add_another_measurement_when_primary_is_available():
    result = reconcile_occupancy(
        [
            measurement(1, 8, boundary=True),
            measurement(2, 5, relationship="alternative", related=1),
        ]
    )
    assert result["occupancy"] == 8
    assert result["excluded_camera_ids"] == [2]


def test_missing_relationship_withholds_claimed_total():
    result = reconcile_occupancy(
        [
            measurement(1, 8),
            OccupancyMeasurement(2, CameraCoverage(), True, 3),
        ]
    )
    assert result["occupancy"] is None
    assert result["state"] == "configuration_required"


def test_observed_empty_is_a_valid_zero():
    result = reconcile_occupancy([measurement(1, 0)])
    assert result["occupancy"] == 0
    assert result["state"] == "estimated"
