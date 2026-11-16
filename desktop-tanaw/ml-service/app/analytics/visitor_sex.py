"""Daily male and female counts for the estimated unique visitors.

Each unique visitor counts once, as male or female, so ``male + female`` always equals the
day's unique visitors. Entries, exits, occupancy and Open Space presence are never split.

A visitor's probability of being female comes from the quality-weighted mean of the calibrated
logits of every observation linked to them (any camera, any track). The day's female count is
the *sum* of visitor probabilities: unlike labelling each person by the likelier side, summed
probabilities do not push every borderline visitor the same way.

Heads are calibrated for an even male/female mix. A real day's mix differs, which would pull the
sum toward half; the probabilities are therefore re-weighted to the day's own mix, estimated by
expectation-maximisation over the day's visitors (Saerens et al., 2002), before summing.
Visitors never seen well enough receive the day's estimated female share, so no "unknown"
category is needed.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal

# Quality scores lie in (0, 1]; a visitor needs at least one usable view.
MIN_EVIDENCE_WEIGHT = 0.05
# Fewer visitors with their own evidence than this cannot set the day's share on their own.
MIN_VISITORS_FOR_SHARE = 5
DEFAULT_FEMALE_SHARE = 0.5
# Heads are trained and calibrated class-balanced, so their probabilities assume this mix.
HEAD_FEMALE_PRIOR = 0.5


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


def reweight_to_share(probabilities: list[float], share: float) -> list[float]:
    """Bayes' rule: probabilities calibrated for an even mix, re-expressed for ``share``."""
    share = min(max(share, 1e-6), 1 - 1e-6)
    adjusted = []
    for value in probabilities:
        female = share * value / HEAD_FEMALE_PRIOR
        male = (1 - share) * (1 - value) / (1 - HEAD_FEMALE_PRIOR)
        adjusted.append(female / (female + male) if female + male > 0 else share)
    return adjusted


def adjust_to_day_mix(
    probabilities: list[float], iterations: int = 200, tolerance: float = 1e-7
) -> tuple[list[float], float]:
    """Estimate the day's female share by EM and return probabilities re-weighted to it."""
    if not probabilities:
        return [], DEFAULT_FEMALE_SHARE
    share = sum(probabilities) / len(probabilities)
    adjusted = probabilities
    for _ in range(iterations):
        adjusted = reweight_to_share(probabilities, share)
        updated = sum(adjusted) / len(adjusted)
        if abs(updated - share) < tolerance:
            share = updated
            break
        share = updated
    return reweight_to_share(probabilities, share), share


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
        if row.get("identity_confidence") not in (None, "high"):
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


def daily_sex_counts(
    rows: Iterable[Mapping[str, Any]], visitors: set[str], prior_share: float | None = None
) -> DailySexCounts:
    """Whole-number male and female counts that always sum to ``len(visitors)``.

    ``prior_share`` is the establishment's recent female share; it is used only when too few of
    the day's visitors were seen well enough to set the share themselves.
    """
    total = len(visitors)
    if total == 0:
        return DailySexCounts(0, 0, "estimated", None, ())
    probabilities, models = visitor_female_probabilities(rows, visitors)
    if not probabilities:
        # No sex head was loaded for any counted visitor: an installation fault, not a category.
        return DailySexCounts(None, None, "unavailable", 0.0, ())
    known = [value for value in probabilities.values() if value is not None]
    if len(known) >= MIN_VISITORS_FOR_SHARE:
        known, share = adjust_to_day_mix(known)
    elif prior_share is not None and 0.0 <= prior_share <= 1.0:
        # Too few views to estimate today's mix; use the establishment's recent one, never
        # so extreme that it overrides a clear view.
        share = min(max(prior_share, 0.05), 0.95)
        known = reweight_to_share(known, share)
    else:
        share = DEFAULT_FEMALE_SHARE
    expected_female = sum(known) + (total - len(known)) * share
    female = min(total, max(0, round(expected_female)))
    return DailySexCounts(
        male_count=total - female,
        female_count=female,
        state="estimated",
        evidence_share=len(known) / total,
        models=tuple(sorted(models)),
    )


def recent_female_share(days: Iterable[Mapping[str, Any]]) -> float | None:
    """Female share across earlier estimated days, or None with too few visitors."""
    female = 0
    counted = 0
    for day in days:
        if day.get("sex_estimation_state") != "estimated" or not day.get("sex_evidence_share"):
            continue
        male_count, female_count = day.get("male_count"), day.get("female_count")
        if not isinstance(male_count, int) or not isinstance(female_count, int):
            continue
        female += female_count
        counted += male_count + female_count
    return female / counted if counted >= MIN_VISITORS_FOR_SHARE else None
