"""Offline training and evaluation of male/female heads on cached embeddings.

Used by ``scripts/train_sex_head.py`` and ``scripts/evaluate_sex_estimator.py``. NumPy only, so
training needs no extra dependencies and is deterministic for a given seed.

Labels use 1 = female, 0 = male, matching the head's output (sigmoid = probability of female).
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import numpy as np

# Acceptance gates a head must meet on held-out data; train_sex_head reports each one.
GATES = {
    "balanced_accuracy": 0.85,
    "back_view_accuracy": 0.80,
    "expected_calibration_error": 0.05,
    "simulated_share_mae": 0.03,
}


@dataclass(frozen=True)
class LinearHead:
    weights: np.ndarray
    bias: float
    temperature: float = 1.0

    def raw_logits(self, embeddings: np.ndarray) -> np.ndarray:
        result: np.ndarray = normalize_rows(embeddings) @ self.weights + self.bias
        return result

    def logits(self, embeddings: np.ndarray) -> np.ndarray:
        """Calibrated logits, identical to ``SexHead.logit`` at runtime."""
        return self.raw_logits(embeddings) / self.temperature


def normalize_rows(embeddings: np.ndarray) -> np.ndarray:
    values = np.asarray(embeddings, dtype=np.float64)
    norms = np.linalg.norm(values, axis=1, keepdims=True)
    if not np.isfinite(values).all() or (norms <= 1e-9).any():
        raise ValueError("Embeddings must be finite and non-zero.")
    result: np.ndarray = values / norms
    return result


def _sigmoid(values: np.ndarray) -> np.ndarray:
    result: np.ndarray = 0.5 * (1.0 + np.tanh(0.5 * values))
    return result


def train_logistic_head(
    embeddings: np.ndarray,
    labels: np.ndarray,
    *,
    l2: float = 1e-3,
    iterations: int = 400,
    learning_rate: float = 0.5,
) -> LinearHead:
    """Class-balanced logistic regression with L2, by full-batch gradient descent with momentum.

    Balancing keeps the head from favouring the majority class of the training data; the
    deployment's own mix is handled by summing calibrated probabilities per day.
    """
    features = normalize_rows(embeddings)
    target = np.asarray(labels, dtype=np.float64)
    if features.shape[0] != target.shape[0] or features.shape[0] == 0:
        raise ValueError("Embeddings and labels must be non-empty and the same length.")
    if not set(np.unique(target)).issubset({0.0, 1.0}) or len(np.unique(target)) < 2:
        raise ValueError("Labels must contain both 0 (male) and 1 (female).")
    positives = target.mean()
    sample_weights = np.where(target == 1, 0.5 / positives, 0.5 / (1 - positives))
    sample_weights /= sample_weights.sum()
    weights = np.zeros(features.shape[1])
    bias = 0.0
    velocity_w = np.zeros_like(weights)
    velocity_b = 0.0
    for _ in range(iterations):
        error = (_sigmoid(features @ weights + bias) - target) * sample_weights
        gradient_w = features.T @ error + l2 * weights
        gradient_b = float(error.sum())
        velocity_w = 0.9 * velocity_w - learning_rate * gradient_w
        velocity_b = 0.9 * velocity_b - learning_rate * gradient_b
        weights += velocity_w
        bias += velocity_b
    return LinearHead(weights=weights.astype(np.float32), bias=float(bias))


def negative_log_likelihood(
    logits: np.ndarray, labels: np.ndarray, balanced: bool = False
) -> float:
    values = np.asarray(logits, dtype=np.float64)
    target = np.asarray(labels, dtype=np.float64)
    # log(1 + exp(-y·z)) with y in {-1, 1}, computed stably.
    signed = np.where(target == 1, values, -values)
    losses = np.logaddexp(0.0, -signed)
    if not balanced:
        return float(np.mean(losses))
    return float((losses[target == 1].mean() + losses[target == 0].mean()) / 2)


def fit_temperature(raw_logits: np.ndarray, labels: np.ndarray) -> float:
    """Temperature minimising class-balanced held-out negative log-likelihood.

    Balancing keeps the calibrated probabilities tied to an even male/female mix, so a
    visitor the head cannot tell apart counts as half male and half female in daily totals.
    """
    low, high = math.log(0.05), math.log(20.0)
    ratio = (math.sqrt(5) - 1) / 2
    a, b = high - ratio * (high - low), low + ratio * (high - low)

    def loss(log_t: float) -> float:
        return negative_log_likelihood(raw_logits / math.exp(log_t), labels, balanced=True)

    loss_a, loss_b = loss(a), loss(b)
    for _ in range(80):
        if loss_a < loss_b:
            high, b, loss_b = b, a, loss_a
            a = high - ratio * (high - low)
            loss_a = loss(a)
        else:
            low, a, loss_a = a, b, loss_b
            b = low + ratio * (high - low)
            loss_b = loss(b)
    return math.exp((low + high) / 2)


def expected_calibration_error(
    probabilities: np.ndarray, labels: np.ndarray, bins: int = 15
) -> float:
    values = np.asarray(probabilities, dtype=np.float64)
    target = np.asarray(labels, dtype=np.float64)
    confidence = np.maximum(values, 1 - values)
    correct = (values >= 0.5) == (target == 1)
    edges = np.linspace(0.5, 1.0, bins + 1)
    error = 0.0
    for index in range(bins):
        upper = edges[index + 1]
        mask = (confidence >= edges[index]) & (
            confidence <= upper if index == bins - 1 else confidence < upper
        )
        if mask.any():
            error += mask.mean() * abs(correct[mask].mean() - confidence[mask].mean())
    return float(error)


def identity_logits(
    logits: np.ndarray, labels: np.ndarray, identities: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """One mean logit per identity, as TANAW combines a visitor's views."""
    groups: dict[str, list[int]] = {}
    for index, identity in enumerate(identities):
        groups.setdefault(str(identity), []).append(index)
    combined = np.array([np.mean(logits[indexes]) for indexes in groups.values()])
    truth = np.array([labels[indexes[0]] for indexes in groups.values()])
    return combined, truth


def simulated_share_error(
    identity_logit_values: np.ndarray,
    identity_labels: np.ndarray,
    *,
    days: int = 400,
    seed: int = 13,
    min_visitors: int = 20,
    max_visitors: int = 500,
) -> dict[str, float]:
    """How far the summed female estimate lands from the truth on realistic days.

    Each simulated day draws a female share between 20% and 80% and a visitor count, samples
    identities to match, and compares the summed probabilities (as at runtime) with the true
    female count.
    """
    rng = np.random.default_rng(seed)
    female = np.flatnonzero(identity_labels == 1)
    male = np.flatnonzero(identity_labels == 0)
    if female.size == 0 or male.size == 0:
        raise ValueError("Both female and male identities are required.")
    probabilities = _sigmoid(np.asarray(identity_logit_values, dtype=np.float64))
    errors: list[float] = []
    for _ in range(days):
        visitors = int(rng.integers(min_visitors, max_visitors + 1))
        share = float(rng.uniform(0.2, 0.8))
        female_visitors = int(round(visitors * share))
        chosen = np.concatenate(
            [
                rng.choice(female, female_visitors, replace=female_visitors > female.size),
                rng.choice(
                    male, visitors - female_visitors, replace=visitors - female_visitors > male.size
                ),
            ]
        )
        estimate = round(float(probabilities[chosen].sum()))
        errors.append(abs(estimate - female_visitors) / visitors)
    values = np.array(errors)
    return {
        "simulated_share_mae": float(values.mean()),
        "simulated_share_p95": float(np.percentile(values, 95)),
    }


def evaluate_head(
    head: LinearHead,
    embeddings: np.ndarray,
    labels: np.ndarray,
    *,
    identities: np.ndarray | None = None,
    views: np.ndarray | None = None,
    simulate_days: int = 400,
) -> dict[str, Any]:
    target = np.asarray(labels, dtype=np.int64)
    logits = head.logits(embeddings)
    probabilities = _sigmoid(logits)
    predicted = probabilities >= 0.5
    female, male = target == 1, target == 0
    metrics: dict[str, Any] = {
        "images": int(target.size),
        "female_share": float(female.mean()),
        "accuracy": float((predicted == female).mean()),
        "balanced_accuracy": float((predicted[female].mean() + (~predicted[male]).mean()) / 2),
        "expected_calibration_error": expected_calibration_error(probabilities, target),
        "negative_log_likelihood": negative_log_likelihood(logits, target),
    }
    if views is not None:
        by_view: dict[str, float] = {}
        for view in sorted({str(value) for value in views if str(value)}):
            mask = np.asarray([str(value) == view for value in views])
            by_view[view] = float((predicted[mask] == female[mask]).mean())
        metrics["accuracy_by_view"] = by_view
        if "back" in by_view:
            metrics["back_view_accuracy"] = by_view["back"]
    ids = identities if identities is not None else np.arange(target.size).astype(str)
    identity_values, identity_truth = identity_logits(logits, target, ids)
    metrics["identities"] = int(identity_truth.size)
    metrics["identity_accuracy"] = float(((identity_values >= 0) == (identity_truth == 1)).mean())
    metrics.update(simulated_share_error(identity_values, identity_truth, days=simulate_days))
    return metrics


def gate_results(metrics: Mapping[str, Any]) -> dict[str, bool | None]:
    """Pass/fail per gate; None when the metric could not be measured on this data."""
    results: dict[str, bool | None] = {}
    for name, threshold in GATES.items():
        value = metrics.get(name)
        if value is None:
            results[name] = None
        elif name in {"expected_calibration_error", "simulated_share_mae"}:
            results[name] = float(value) <= threshold
        else:
            results[name] = float(value) >= threshold
    return results


@dataclass(frozen=True)
class EmbeddingCache:
    """Embeddings of labelled person images from one dataset split and one embedding space."""

    embeddings: np.ndarray
    female: np.ndarray
    identity: np.ndarray
    view: np.ndarray
    embedding_space: str

    def save(self, path: Any) -> None:
        np.savez_compressed(
            path,
            embeddings=self.embeddings.astype(np.float32),
            female=self.female.astype(np.int8),
            identity=self.identity.astype(str),
            view=self.view.astype(str),
            embedding_space=np.str_(self.embedding_space),
        )

    @classmethod
    def load(cls, path: Any) -> EmbeddingCache:
        with np.load(path, allow_pickle=False) as archive:
            return cls(
                embeddings=np.asarray(archive["embeddings"], dtype=np.float32),
                female=np.asarray(archive["female"], dtype=np.int64),
                identity=np.asarray(archive["identity"]).astype(str),
                view=np.asarray(archive["view"]).astype(str),
                embedding_space=str(archive["embedding_space"]),
            )

    @classmethod
    def concatenate(cls, caches: list[EmbeddingCache]) -> EmbeddingCache:
        if not caches:
            raise ValueError("At least one embedding cache is required.")
        spaces = {cache.embedding_space for cache in caches}
        if len(spaces) != 1:
            raise ValueError(f"Caches mix embedding spaces: {sorted(spaces)}")
        return cls(
            embeddings=np.concatenate([cache.embeddings for cache in caches]),
            female=np.concatenate([cache.female for cache in caches]),
            identity=np.concatenate([cache.identity for cache in caches]),
            view=np.concatenate([cache.view for cache in caches]),
            embedding_space=spaces.pop(),
        )
