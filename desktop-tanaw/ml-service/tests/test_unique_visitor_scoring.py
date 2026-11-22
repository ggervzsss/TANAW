from app.evaluation.unique_visitors import score_unique_visitors


def test_scoring_separates_duplicates_from_false_merges() -> None:
    # Ann is hidden and comes back as track 2 (a duplicate visitor); Ben and Cy share one
    # visitor (a false merge); Di is never identified; track 6 is unlabelled.
    track_visitors = {"1": "v1", "2": "v2", "3": "v3", "4": "v3", "5": None, "6": "v4"}
    track_sources = {"1": {10}, "2": {11}, "3": {12}, "4": {13}, "5": {14}, "6": {15}}
    people = {10: "ann", 11: "ann", 12: "ben", 13: "cy", 14: "di", 15: None}
    result = score_unique_visitors(track_visitors, track_sources, people, predicted_unique=4)
    assert result["true_unique"] == 4
    assert result["unique_error"] == 0
    assert result["duplicate_visitors"] == 1
    assert result["false_merges"] == 1
    assert result["people_split"] == ["ann"]
    assert result["visitors_merging_people"] == ["v3"]
    assert result["people_never_identified"] == ["di"]
    assert result["unlabelled_tracks"] == 1


def test_a_track_follows_the_person_most_of_its_sources_show() -> None:
    result = score_unique_visitors(
        {"1": "v1", "2": "v1"},
        {"1": {10, 11, 12}, "2": {13}},
        {10: "ann", 11: "ann", 12: "ben", 13: "ann"},
        predicted_unique=1,
    )
    assert result["true_unique"] == 1
    assert result["duplicate_visitors"] == 0 and result["false_merges"] == 0
