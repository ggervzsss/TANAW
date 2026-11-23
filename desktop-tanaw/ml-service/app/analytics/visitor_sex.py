"""Daily male and female counts for the estimated unique visitors.

Each unique visitor counts once, as male or female, so ``male + female`` always equals the
day's unique visitors. Entries, exits, occupancy and Open Space presence are never split.

``visitors`` are the day's counting units: confirmed visitors and the degraded units counted
for people without a settled identity, so the split always covers the reported unique count.

A visitor's probability of being female comes from the quality-weighted mean of the calibrated
logits of every observation linked to them (any camera, any track). The day's female count is
the *sum* of visitor probabilities: unlike labelling each person by the likelier side, summed
probabilities do not push every borderline visitor the same way.

Each visitor is judged only on their own appearance. Heads are calibrated for an even
male/female mix, so a visitor the head cannot tell apart counts as half male and half female,
and a visitor never seen well enough counts as exactly half of each. Nothing about the rest of
the day, or earlier days, moves one visitor's estimate toward the majority. The cost is that the
head's own mistakes are not corrected: on a day far from an even mix, misread visitors pull the
split toward half.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

# Quality scores lie in (0, 1]; a visitor needs at least one usable view.
MIN_EVIDENCE_WEIGHT = 0.05
# Female probability of a visitor never seen well enough to judge: an even split.
UNSEEN_FEMALE_PROBABILITY = 0.5


@dataclass(frozen=True)
class DailySexCounts:
    male_count: int | None
    female_count: int | None
    state: Literal["estimated", "unavailable"]
    # Share of the day's visitors estimated from their own appearance.
    evidence_share: float | None
    models: tuple[str, ...]

    def as_metrics(self) -> dict[str, Any]:
        return {
            "male_count": self.male_count,
            "female_count": self.female_count,
            "sex_estimation_state": self.state,
            "sex_evidence_share": self.evidence_share,
            "sex_models": list(self.models),
        }


def sigmoid(value: float) -> float:
    if value >= 0:
        return 1.0 / (1.0 + math.exp(-value))
    exponent = math.exp(value)
    return exponent / (1.0 + exponent)


def visitor_female_probabilities(
    rows: Iterable[Mapping[str, Any]], visitors: set[str]
) -> tuple[dict[str, float | None], set[str]]:
    """Probability of female per visitor (None without usable views) and the head versions used.

    A visitor appears with ``None`` when the estimator ran but never saw them well; visitors whose
    observations carry no evidence at all are absent from the result.
    """
    sums: dict[str, float] = {}
    weights: dict[str, float] = {}
    models: set[str] = set()
    for row in rows:
        visitor = row.get("visitor_id")
        model = row.get("sex_model")
        if visitor not in visitors or model is None:
            continue
        models.add(str(model))
        weight = float(row.get("sex_weight") or 0.0)
        logit_sum = row.get("sex_logit_sum")
        sums.setdefault(visitor, 0.0)
        weights.setdefault(visitor, 0.0)
        if weight > 0 and logit_sum is not None and math.isfinite(float(logit_sum)):
            sums[visitor] += float(logit_sum)
            weights[visitor] += weight
    probabilities: dict[str, float | None] = {
        visitor: sigmoid(sums[visitor] / weights[visitor])
        if weights[visitor] >= MIN_EVIDENCE_WEIGHT
        else None
        for visitor in sums
    }
    return probabilities, models


def daily_sex_counts(rows: Iterable[Mapping[str, Any]], visitors: set[str]) -> DailySexCounts:
    """Whole-number male and female counts that always sum to ``len(visitors)``."""
    total = len(visitors)
    if total == 0:
        return DailySexCounts(0, 0, "estimated", None, ())
    probabilities, models = visitor_female_probabilities(rows, visitors)
    if not probabilities:
        # No sex head was loaded for any counted visitor: an installation fault, not a category.
        return DailySexCounts(None, None, "unavailable", 0.0, ())
    known = [value for value in probabilities.values() if value is not None]
    if not known:
        # Nobody was seen well enough to judge; an even split would be invented, not estimated.
        return DailySexCounts(None, None, "unavailable", 0.0, tuple(sorted(models)))
    expected_female = sum(known) + (total - len(known)) * UNSEEN_FEMALE_PROBABILITY
    female = min(total, max(0, round(expected_female)))
    return DailySexCounts(
        male_count=total - female,
        female_count=female,
        state="estimated",
        evidence_share=len(known) / total,
        models=tuple(sorted(models)),
    )
