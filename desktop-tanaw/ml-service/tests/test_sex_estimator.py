"""Male/female estimation head: file format, calibrated logits and per-track evidence."""

import math
import time
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from app.attributes import SexEstimator, SexHead, write_sex_head
from app.reid import TrackAppearanceBuffer

SPACE = "torchreid_osnet_ain_x1_0_msmt17_onnx@abc:128x256:head_mask=0"
FEMALE = np.array([1.0, 0.0, 0.0], dtype=np.float32)
MALE = np.array([-1.0, 0.0, 0.0], dtype=np.float32)


def head(tmp_path: Path, temperature: float = 2.0, **changes: Any) -> SexHead:
    args = dict(
        embedding_space=SPACE,
        weights=np.array([4.0, 0.0, 0.0]),
        bias=0.5,
        temperature=temperature,
    )
    return write_sex_head(tmp_path / "sex_head_quality.npz", **{**args, **changes})


def test_head_round_trips_and_applies_temperature(tmp_path: Path) -> None:
    loaded = head(tmp_path)
    assert loaded.embedding_space == SPACE
    assert loaded.dimension == 3
    assert loaded.version.startswith("sex-head@")
    # (4 * 1 + 0.5) / 2
    assert loaded.logit(FEMALE) == pytest.approx(2.25)
    # Embeddings are L2-normalised before scoring, as at training time.
    assert loaded.logit(FEMALE * 7) == pytest.approx(2.25)
    assert loaded.logit(MALE) == pytest.approx(-1.75)


def test_head_rejects_wrong_dimension_and_empty_embeddings(tmp_path: Path) -> None:
    loaded = head(tmp_path)
    with pytest.raises(ValueError, match="3-d"):
        loaded.logit(np.ones(4, dtype=np.float32))
    with pytest.raises(ValueError, match="non-zero"):
        loaded.logit(np.zeros(3, dtype=np.float32))


@pytest.mark.parametrize(
    "changes,message",
    [
        ({"weights": np.array([np.nan, 1.0, 0.0])}, "weights"),
        ({"weights": np.array([])}, "weights"),
        ({"temperature": 0.0}, "temperature"),
        ({"bias": float("inf")}, "bias"),
        ({"embedding_space": ""}, "embedding space"),
    ],
)
def test_invalid_heads_are_rejected(tmp_path: Path, changes: dict[str, Any], message: str) -> None:
    with pytest.raises(ValueError, match=message):
        head(tmp_path, **changes)


def test_estimator_loads_valid_files_and_reports_missing_or_broken_ones(tmp_path: Path) -> None:
    good = head(tmp_path)
    broken = tmp_path / "sex_head_fast.npz"
    broken.write_bytes(b"not a head")
    estimator = SexEstimator.from_files([good_path := tmp_path / "sex_head_quality.npz", broken])
    assert (matched := estimator.head_for(SPACE)) is not None
    assert matched.version == good.version
    assert estimator.head_for("other-space") is None
    status = estimator.status([SPACE, "other-space"])
    assert status["sex_estimation_available"] is True
    assert status["sex_heads_matched"] == 1
    assert "sex_head_fast.npz" in status["sex_head_errors"]
    missing = SexEstimator.from_files([tmp_path / "absent.npz"])
    assert missing.status([SPACE])["sex_estimation_available"] is False
    assert missing.status([SPACE])["sex_head_errors"] == {"absent.npz": "missing"}
    assert good_path.is_file()


def test_evidence_is_quality_weighted_and_skips_unusable_samples(tmp_path: Path) -> None:
    estimator = SexEstimator([head(tmp_path)])
    evidence = estimator.evidence(
        [(FEMALE, 0.75), (MALE, 0.25), (MALE, 0.0), (np.zeros(3), 0.5), (FEMALE, math.nan)],
        SPACE,
    )
    assert evidence is not None
    assert evidence.weight == pytest.approx(1.0)
    assert evidence.logit_sum == pytest.approx(0.75 * 2.25 + 0.25 * -1.75)
    assert evidence.model.startswith("sex-head@")


def test_evidence_records_that_estimation_ran_without_usable_views(tmp_path: Path) -> None:
    estimator = SexEstimator([head(tmp_path)])
    evidence = estimator.evidence([], SPACE)
    assert evidence is not None and evidence.weight == 0
    assert estimator.evidence([(FEMALE, 1.0)], "unmatched-space") is None


def test_track_buffer_exposes_kept_samples_and_merges_them_on_remap() -> None:
    buffer = TrackAppearanceBuffer(max_samples_per_track=3)
    buffer.record_sample(1, FEMALE, 0.4, 1)
    buffer.record_sample(1, FEMALE, 0.9, 5)
    buffer.record_sample(2, MALE, 0.6, 6)
    assert [quality for _, quality in buffer.samples_for_track(1)] == [0.9, 0.4]
    buffer.remap_track(2, 1)
    assert [quality for _, quality in buffer.samples_for_track(1)] == [0.9, 0.6, 0.4]
    assert buffer.samples_for_track(2) == []


def test_scoring_stays_within_the_per_embedding_budget(tmp_path: Path) -> None:
    rng = np.random.default_rng(7)
    estimator = SexEstimator([head(tmp_path, weights=rng.normal(size=512), embedding_space=SPACE)])
    samples = [(rng.normal(size=512).astype(np.float32), 0.8) for _ in range(2000)]
    started = time.perf_counter()
    estimator.evidence(samples, SPACE)
    per_embedding_ms = (time.perf_counter() - started) * 1000 / len(samples)
    assert per_embedding_ms < 0.1
