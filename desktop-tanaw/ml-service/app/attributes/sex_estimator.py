"""Estimate whether a visitor is female from the appearance embeddings TANAW already computes.

A *sex head* is a small linear classifier trained offline on top of one re-identification
embedding space (see ``scripts/train_sex_head.py``). It turns one embedding into a calibrated
logit: ``sigmoid(logit)`` is the probability that the person is female. Per-track evidence is
the quality-weighted sum of those logits, so a visitor's estimate improves with every good view.

Only totals are reported: daily male and female counts are the sum of visitor probabilities
(see ``app.analytics.visitor_sex``). No per-person label is stored.
"""

from __future__ import annotations

import hashlib
import logging
import math
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

SEX_HEAD_FORMAT = 1


@dataclass(frozen=True)
class SexEvidence:
    """Quality-weighted sum of calibrated logits for one track.

    ``weight`` is zero when the head ran but no view was good enough; ``model`` still records
    that estimation was available, so the visitor receives the day's share rather than none.
    """

    logit_sum: float
    weight: float
    model: str


@dataclass(frozen=True)
class SexHead:
    embedding_space: str
    weights: np.ndarray
    bias: float
    temperature: float
    version: str

    @property
    def dimension(self) -> int:
        return int(self.weights.size)

    def logit(self, embedding: np.ndarray) -> float:
        """Calibrated logit; ``sigmoid`` of it is the probability of female."""
        vector = np.asarray(embedding, dtype=np.float32).reshape(-1)
        if vector.size != self.dimension:
            raise ValueError(
                f"Sex head expects {self.dimension}-d embeddings, received {vector.size}-d."
            )
        norm = float(np.linalg.norm(vector))
        if not math.isfinite(norm) or norm <= 1e-9:
            raise ValueError("Embedding must be finite and non-zero.")
        raw = float(np.dot(self.weights, vector / norm)) + self.bias
        return raw / self.temperature

    @classmethod
    def load(cls, path: Path) -> SexHead:
        data = path.read_bytes()
        with np.load(path, allow_pickle=False) as archive:
            if int(archive["format"]) != SEX_HEAD_FORMAT:
                raise ValueError(f"Unsupported sex head format in {path.name}.")
            weights = np.asarray(archive["weights"], dtype=np.float32)
            bias = float(archive["bias"])
            temperature = float(archive["temperature"])
            embedding_space = str(archive["embedding_space"])
        if weights.ndim != 1 or weights.size == 0 or not np.isfinite(weights).all():
            raise ValueError(f"Sex head weights in {path.name} are invalid.")
        if not math.isfinite(bias) or not math.isfinite(temperature) or temperature <= 0:
            raise ValueError(f"Sex head bias or temperature in {path.name} is invalid.")
        if not embedding_space:
            raise ValueError(f"Sex head {path.name} does not name its embedding space.")
        return cls(
            embedding_space=embedding_space,
            weights=weights,
            bias=bias,
            temperature=temperature,
            version=f"sex-head@{hashlib.sha256(data).hexdigest()[:16]}",
        )


def write_sex_head(
    path: Path, *, embedding_space: str, weights: np.ndarray, bias: float, temperature: float
) -> SexHead:
    """Write a head in the runtime format and return it as loaded back from disk."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as handle:
        np.savez(
            handle,
            format=np.int64(SEX_HEAD_FORMAT),
            weights=np.asarray(weights, dtype=np.float32).reshape(-1),
            bias=np.float64(bias),
            temperature=np.float64(temperature),
            embedding_space=np.str_(embedding_space),
        )
    return SexHead.load(path)


class SexEstimator:
    """Holds the heads that load cleanly; a missing or broken file disables only its space."""

    def __init__(self, heads: Iterable[SexHead] = (), errors: dict[str, str] | None = None):
        self._heads = {head.embedding_space: head for head in heads}
        self._errors = dict(errors or {})

    @classmethod
    def from_files(cls, paths: Iterable[Path]) -> SexEstimator:
        heads: list[SexHead] = []
        errors: dict[str, str] = {}
        for path in paths:
            if not path.is_file():
                errors[path.name] = "missing"
                continue
            try:
                heads.append(SexHead.load(path))
            except (OSError, KeyError, ValueError) as exc:
                logger.warning("Sex head %s could not be loaded: %s", path.name, exc)
                errors[path.name] = str(exc)
        return cls(heads, errors)

    def head_for(self, embedding_space: str | None) -> SexHead | None:
        return self._heads.get(embedding_space) if embedding_space else None

    def evidence(
        self, samples: Iterable[tuple[np.ndarray, float]], embedding_space: str | None
    ) -> SexEvidence | None:
        """Quality-weighted evidence from a track's kept samples, or None without a head."""
        head = self.head_for(embedding_space)
        if head is None:
            return None
        logit_sum = 0.0
        weight = 0.0
        for embedding, quality in samples:
            if not math.isfinite(quality) or quality <= 0:
                continue
            try:
                logit = head.logit(embedding)
            except ValueError:
                continue
            logit_sum += quality * logit
            weight += quality
        return SexEvidence(logit_sum=logit_sum, weight=weight, model=head.version)

    def status(self, active_spaces: Iterable[str] = ()) -> dict[str, Any]:
        active = [space for space in active_spaces if space]
        matched = [space for space in active if space in self._heads]
        return {
            "sex_estimation_available": bool(matched),
            "sex_heads": [
                {"embedding_space": head.embedding_space, "version": head.version}
                for head in sorted(self._heads.values(), key=lambda item: item.embedding_space)
            ],
            "sex_heads_matched": len(matched),
            "sex_head_errors": dict(sorted(self._errors.items())),
        }


class TrackSexTally:
    """Running male/female evidence per track for offline replay of recorded video.

    Live cameras read evidence from the appearance buffer when an observation is saved; a
    replay instead keeps a tally that survives the buffer's track expiry, so every track of a
    whole video can be scored at the end.
    """

    def __init__(self, estimator: SexEstimator) -> None:
        self._estimator = estimator
        self._tallies: dict[str, dict[int, list[float]]] = {}

    def add(self, track_id: int, embedding: np.ndarray, quality: float, space: str) -> None:
        head = self._estimator.head_for(space)
        if head is None or not math.isfinite(quality) or quality <= 0:
            return
        try:
            logit = head.logit(embedding)
        except ValueError:
            return
        tally = self._tallies.setdefault(space, {}).setdefault(track_id, [0.0, 0.0])
        tally[0] += quality * logit
        tally[1] += quality

    def remap(self, previous_track_id: int, target_track_id: int) -> None:
        if previous_track_id == target_track_id:
            return
        for tallies in self._tallies.values():
            previous = tallies.pop(previous_track_id, None)
            if previous is None:
                continue
            target = tallies.setdefault(target_track_id, [0.0, 0.0])
            target[0] += previous[0]
            target[1] += previous[1]

    def evidence(self, track_id: int, spaces: Iterable[str]) -> SexEvidence | None:
        """Evidence from the first listed space that saw the track; spaces are in preference order."""
        fallback: SexEvidence | None = None
        for space in spaces:
            head = self._estimator.head_for(space)
            if head is None:
                continue
            logit_sum, weight = self._tallies.get(space, {}).get(track_id, [0.0, 0.0])
            evidence = SexEvidence(logit_sum=logit_sum, weight=weight, model=head.version)
            if weight > 0:
                return evidence
            fallback = fallback or evidence
        return fallback
