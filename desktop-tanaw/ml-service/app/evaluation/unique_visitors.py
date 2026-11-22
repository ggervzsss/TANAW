"""Score estimated unique visitors against hand-labelled people.

Labels name the real person behind each detector track (the cached BoT-SORT source ID).
A replay reports which visitor each physical track was counted as. Two kinds of error
matter, and they pull in opposite directions:

* a *duplicate* is one person counted as more than one visitor (over-counting);
* a *false merge* is one visitor that covers more than one person (under-counting).

The true count is every labelled person, not only those the replay counted, so a person the
pipeline missed entirely shows up as an error instead of vanishing from the comparison.
"""

from collections import Counter, defaultdict
from collections.abc import Mapping
from typing import Any


def score_unique_visitors(
    track_visitors: Mapping[str, str | None],
    track_sources: Mapping[str, set[int]],
    source_people: Mapping[int, str | None],
    predicted_unique: int,
) -> dict[str, Any]:
    """Compare a replay's visitors with labelled people.

    ``track_visitors`` maps each counted physical track to its visitor (None when it was
    never identified). ``track_sources`` lists the detector source IDs each physical track
    covered, and ``source_people`` labels those source IDs; every person named there should
    be counted. Unlabelled (None) sources are ignored.
    """
    person_visitors: dict[str, set[str]] = defaultdict(set)
    visitor_people: dict[str, set[str]] = defaultdict(set)
    unidentified: set[str] = set()
    unlabelled_tracks = 0
    for track, visitor in track_visitors.items():
        votes = Counter(
            person
            for source in track_sources.get(track, set())
            if (person := source_people.get(source)) is not None
        )
        if not votes:
            unlabelled_tracks += 1
            continue
        person = votes.most_common(1)[0][0]
        if visitor is None:
            unidentified.add(person)
            continue
        person_visitors[person].add(visitor)
        visitor_people[visitor].add(person)

    people = {person for person in source_people.values() if person is not None}
    duplicates = sum(len(visitors) - 1 for visitors in person_visitors.values())
    false_merges = sum(len(persons) - 1 for persons in visitor_people.values())
    never_identified = sorted(unidentified - set(person_visitors))
    missed = sorted(people - set(person_visitors) - unidentified)
    return {
        "true_unique": len(people),
        "predicted_unique": predicted_unique,
        "unique_error": predicted_unique - len(people),
        "duplicate_visitors": duplicates,
        "false_merges": false_merges,
        "people_split": sorted(p for p, visitors in person_visitors.items() if len(visitors) > 1),
        "visitors_merging_people": sorted(
            v for v, persons in visitor_people.items() if len(persons) > 1
        ),
        "people_never_identified": never_identified,
        # Labelled people whose tracks were never counted as their own visit.
        "people_missed": missed,
        "unlabelled_tracks": unlabelled_tracks,
    }
