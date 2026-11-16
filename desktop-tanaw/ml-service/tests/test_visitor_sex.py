"""Daily male/female counts: one per unique visitor, always summing to the unique count."""

import random
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from app.analytics.visitor_sex import (
    DEFAULT_FEMALE_SHARE,
    MIN_VISITORS_FOR_SHARE,
    adjust_to_day_mix,
    daily_sex_counts,
    recent_female_share,
    reweight_to_share,
    sigmoid,
    visitor_female_probabilities,
)
from app.attributes import SexEvidence
from app.identity.establishment_registry import EstablishmentRegistry
from app.storage.repositories.establishment_repository import day_bounds
from app.storage.repositories.establishment_sample_repository import prepare_sample_period

MODEL = "sex-head@test"


def row(
    visitor: str | None, logit: float | None, weight: float = 1.0, **changes: Any
) -> dict[str, Any]:
    return {
        "visitor_id": visitor,
        "identity_confidence": "high",
        "sex_logit_sum": None if logit is None else logit * weight,
        "sex_weight": weight if logit is not None else 0.0,
        "sex_model": MODEL,
        **changes,
    }


def test_visitor_probability_combines_every_observation_by_weight() -> None:
    rows = [
        row("a", 2.0, 0.5),
        row("a", -1.0, 1.5),
        row("b", None),
        row("c", 3.0, identity_confidence="low"),
        row("d", 3.0, sex_model=None),
    ]
    probabilities, models = visitor_female_probabilities(rows, {"a", "b", "c", "d"})
    assert probabilities["a"] == pytest.approx(sigmoid((2.0 * 0.5 - 1.0 * 1.5) / 2.0))
    assert probabilities["b"] is None
    assert "c" not in probabilities and "d" not in probabilities
    assert models == {MODEL}


def test_every_visitor_is_male_or_female_and_unseen_visitors_take_the_day_share() -> None:
    visitors = {f"v{index}" for index in range(10)}
    # Five clearly female, three clearly male, two never seen well.
    rows = [row(f"v{index}", 12.0) for index in range(5)]
    rows += [row(f"v{index}", -12.0) for index in range(5, 8)]
    rows += [row("v8", None), row("v9", None)]
    counts = daily_sex_counts(rows, visitors)
    assert counts.state == "estimated"
    assert counts.male_count is not None and counts.female_count is not None
    assert counts.male_count + counts.female_count == 10
    # 5 seen female + 2 unseen × 0.625 (the day share) = 6.25
    assert counts.female_count == 6
    assert counts.evidence_share == pytest.approx(0.8)
    assert counts.models == (MODEL,)


def test_small_days_use_the_recent_share_then_an_even_split() -> None:
    visitors = {"a", "b", "c", "d"}
    rows = [row("a", 12.0), row("b", None), row("c", None), row("d", None)]
    assert len(visitors) < MIN_VISITORS_FOR_SHARE + 1
    assert daily_sex_counts(rows, visitors, prior_share=0.0).female_count == 1
    assert daily_sex_counts(rows, visitors, prior_share=1.0).female_count == 4
    assert DEFAULT_FEMALE_SHARE == 0.5
    # 1 + 3 × 0.5 = 2.5 → 2 (half to even)
    assert daily_sex_counts(rows, visitors).female_count == 2


def test_missing_model_is_unavailable_not_a_category() -> None:
    counts = daily_sex_counts([row("a", 3.0, sex_model=None)], {"a"})
    assert (counts.male_count, counts.female_count, counts.state) == (None, None, "unavailable")
    empty = daily_sex_counts([], set())
    assert (empty.male_count, empty.female_count, empty.state) == (0, 0, "estimated")


def test_counts_always_sum_to_unique_visitors_for_random_days() -> None:
    rng = random.Random(11)
    for _ in range(300):
        visitors = {f"v{index}" for index in range(rng.randint(1, 60))}
        rows = []
        for visitor in visitors:
            for _ in range(rng.randint(1, 3)):
                seen = rng.random() < 0.8
                rows.append(row(visitor, rng.uniform(-8, 8) if seen else None, rng.random()))
        prior = rng.choice([None, rng.random()])
        counts = daily_sex_counts(rows, visitors, prior)
        assert counts.male_count is not None and counts.female_count is not None
        assert counts.male_count >= 0 and counts.female_count >= 0
        assert counts.male_count + counts.female_count == len(visitors)
        assert counts == daily_sex_counts(list(reversed(rows)), visitors, prior)


def test_days_far_from_an_even_mix_are_counted_close_to_the_truth() -> None:
    """Calibrated heads assume an even mix; the daily adjustment recovers uneven days."""
    rng = np.random.default_rng(3)
    logits = rng.normal(0, 3, 20000)
    labels = rng.random(20000) < 1 / (1 + np.exp(-logits))
    female, male = np.flatnonzero(labels), np.flatnonzero(~labels)
    for share in (0.2, 0.5, 0.8):
        females = int(400 * share)
        chosen = np.concatenate([rng.choice(female, females), rng.choice(male, 400 - females)])
        rows = [row(f"v{index}", float(logits[item])) for index, item in enumerate(chosen)]
        counts = daily_sex_counts(rows, {f"v{index}" for index in range(400)})
        assert counts.female_count is not None
        assert abs(counts.female_count - females) / 400 < 0.05
        naive = sum(1 / (1 + np.exp(-logits[chosen])))
        if share != 0.5:
            assert abs(counts.female_count - females) < abs(naive - females)


def test_mix_adjustment_finds_the_day_share() -> None:
    probabilities = [0.9] * 70 + [0.1] * 30
    adjusted, share = adjust_to_day_mix(probabilities)
    assert 0.7 < share < 0.8
    assert sum(adjusted) == pytest.approx(share * 100)
    assert reweight_to_share([0.5], 0.8) == pytest.approx([0.8])
    assert adjust_to_day_mix([]) == ([], 0.5)


def test_recent_share_uses_only_estimated_days_with_evidence() -> None:
    days: list[dict[str, Any]] = [
        {
            "sex_estimation_state": "estimated",
            "sex_evidence_share": 0.9,
            "male_count": 3,
            "female_count": 7,
        },
        {
            "sex_estimation_state": "estimated",
            "sex_evidence_share": 0.0,
            "male_count": 9,
            "female_count": 1,
        },
        {"sex_estimation_state": "unavailable", "male_count": None, "female_count": None},
        {"unique_count": 5},
    ]
    assert recent_female_share(days) == pytest.approx(0.7)
    assert recent_female_share(days[1:]) is None


NOW = datetime(2026, 11, 10, 2, tzinfo=UTC)


def observe(service: EstablishmentRegistry, key: str, vector: np.ndarray, **changes: Any) -> object:
    at = changes.pop("observed_at", NOW)
    camera = changes.pop("camera", 1)
    return service.observe(
        observation_id=key,
        camera_id=camera,
        track_key=key,
        analysis_mode="entrance_exit" if camera == 1 else "open_space",
        kind="entry" if camera == 1 else "area_visit",
        qualified=True,
        first_at=at,
        observed_at=at,
        embedding=vector,
        **changes,
    )


def day_summary(service: EstablishmentRegistry, date: str = "2026-11-10") -> dict[str, Any]:
    start, end = (datetime.fromisoformat(value) for value in day_bounds(date))
    return service.repository.summary(start, end)


def test_registry_counts_a_visitor_seen_by_two_cameras_once(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    vectors = np.eye(3, dtype=np.float32)
    female = SexEvidence(logit_sum=6.0, weight=1.0, model=MODEL)
    male = SexEvidence(logit_sum=-6.0, weight=1.0, model=MODEL)
    observe(service, "door:0", vectors[0], sex_evidence=female)
    observe(
        service,
        "area:0",
        vectors[0],
        camera=2,
        observed_at=NOW + timedelta(minutes=5),
        sex_evidence=female,
    )
    observe(service, "door:1", vectors[1], sex_evidence=male)
    observe(service, "door:2", vectors[2], sex_evidence=male)
    result = day_summary(service)
    assert result["unique_count"] == 3
    assert (result["male_count"], result["female_count"]) == (2, 1)
    assert result["sex_estimation_state"] == "estimated"
    day = result["days"][0]
    assert day["male_count"] + day["female_count"] == day["unique_count"]
    # Entries and exits are never split by sex.
    assert "male_entries" not in result and result["entries"] == 3


def test_later_evidence_replaces_earlier_and_missing_evidence_keeps_it(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    vector = np.array([1, 0, 0], dtype=np.float32)
    observe(service, "door", vector, sex_evidence=SexEvidence(-6.0, 1.0, MODEL))
    assert day_summary(service)["female_count"] == 0
    observe(service, "door", vector, sex_evidence=SexEvidence(18.0, 2.0, MODEL))
    assert day_summary(service)["female_count"] == 1
    observe(service, "door", vector)
    assert day_summary(service)["female_count"] == 1


def test_days_without_a_sex_head_are_unavailable(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    observe(service, "door", np.array([1, 0, 0], dtype=np.float32))
    result = day_summary(service)
    assert result["unique_count"] == 1
    assert (result["male_count"], result["female_count"]) == (None, None)
    assert result["sex_estimation_state"] == "unavailable"
    assert result["policy_version"] == 3


def test_sample_months_have_male_and_female_for_every_day(tmp_path: Path) -> None:
    service = EstablishmentRegistry(str(tmp_path), "park")
    prepare_sample_period(
        service.repository,
        report_id="REP-SAMPLE",
        period="October 2026",
        entries=360,
        exits=340,
        unique_count=300,
        now=datetime(2026, 11, 2, tzinfo=UTC),
    )
    start = datetime.fromisoformat(day_bounds("2026-10-01")[0])
    end = datetime.fromisoformat(day_bounds("2026-11-01")[0])
    result = service.repository.summary(start, end)
    assert result["unique_count"] > 0
    assert result["male_count"] + result["female_count"] == result["unique_count"]
    assert 0.35 < result["female_count"] / result["unique_count"] < 0.65
    for day in result["days"]:
        assert day["male_count"] + day["female_count"] == day["unique_count"]
