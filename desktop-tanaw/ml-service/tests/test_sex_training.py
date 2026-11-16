"""Offline head training, dataset readers and evaluation, on synthetic data only."""

from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import numpy as np
import pytest

from app.attributes import SexEstimator, SexHead, TrackSexTally, write_sex_head
from app.attributes.datasets import (
    ManifestRow,
    Split,
    pa100k_rows,
    peta_rows,
    rap_v2_rows,
    read_manifest,
    write_manifest,
)
from app.attributes.training import (
    EmbeddingCache,
    LinearHead,
    evaluate_head,
    expected_calibration_error,
    fit_temperature,
    gate_results,
    simulated_share_error,
    train_logistic_head,
)
from app.evaluation.replay_reid import ReplayReIdCoordinator
from scripts.build_sex_dataset_cache import build_caches
from scripts.evaluate_sex_estimator import evaluate_caches, evaluate_replay
from scripts.train_sex_head import train

SPACE = "torchreid_osnet_ain_x1_0_msmt17_onnx@test:128x256:head_mask=0"


def synthetic(
    count: int, seed: int, separation: float = 1.2, dimension: int = 32
) -> tuple[np.ndarray, np.ndarray]:
    """Two overlapping clusters on either side of a hidden direction; 1 = female."""
    rng = np.random.default_rng(seed)
    direction = np.zeros(dimension)
    direction[0] = 1.0
    labels = rng.integers(0, 2, count)
    points = rng.normal(size=(count, dimension)) + np.outer(labels * 2 - 1, direction) * separation
    return points.astype(np.float32), labels


def cache(path: Path, count: int, seed: int, **changes: str) -> Path:
    embeddings, labels = synthetic(count, seed)
    EmbeddingCache(
        embeddings=embeddings,
        female=labels,
        identity=np.array([f"id{seed}:{index // 2}" for index in range(count)]),
        view=np.array(["back" if index % 3 == 0 else "front" for index in range(count)]),
        embedding_space=changes.get("embedding_space", SPACE),
    ).save(path)
    return path


def test_logistic_head_learns_a_separable_direction() -> None:
    embeddings, labels = synthetic(4000, 1)
    head = train_logistic_head(embeddings, labels)
    test, truth = synthetic(2000, 2)
    metrics = evaluate_head(head, test, truth, simulate_days=50)
    assert metrics["balanced_accuracy"] > 0.85
    assert metrics["identities"] == 2000


def test_training_balances_classes() -> None:
    embeddings, labels = synthetic(4000, 3)
    keep = (labels == 1) | (np.arange(labels.size) % 5 == 0)
    head = train_logistic_head(embeddings[keep], labels[keep])
    predicted = head.logits(embeddings) >= 0
    assert abs(predicted.mean() - labels.mean()) < 0.1


def test_training_rejects_single_class_and_bad_shapes() -> None:
    embeddings, _ = synthetic(10, 4)
    with pytest.raises(ValueError, match="both"):
        train_logistic_head(embeddings, np.ones(10))
    with pytest.raises(ValueError, match="same length"):
        train_logistic_head(embeddings, np.ones(9))


def test_temperature_scaling_repairs_overconfident_logits() -> None:
    rng = np.random.default_rng(5)
    honest = rng.normal(0, 2, 20000)
    labels = (rng.random(20000) < 1 / (1 + np.exp(-honest))).astype(int)
    overconfident = honest * 4
    temperature = fit_temperature(overconfident, labels)
    assert temperature == pytest.approx(4, rel=0.1)
    before = expected_calibration_error(1 / (1 + np.exp(-overconfident)), labels)
    after = expected_calibration_error(1 / (1 + np.exp(-overconfident / temperature)), labels)
    assert after < 0.02 < before


def test_simulated_share_error_is_small_for_calibrated_identities() -> None:
    rng = np.random.default_rng(6)
    logits = rng.normal(0, 3, 5000)
    labels = (rng.random(5000) < 1 / (1 + np.exp(-logits))).astype(int)
    result = simulated_share_error(logits, labels, days=200)
    assert result["simulated_share_mae"] < 0.035
    # Without the daily mix adjustment, days far from an even mix are pulled toward half.
    unadjusted = simulated_share_error(logits, labels, days=200, adjust=False)
    assert unadjusted["simulated_share_mae"] > 1.5 * result["simulated_share_mae"]


def test_gates_report_pass_fail_and_unmeasured() -> None:
    results = gate_results(
        {"balanced_accuracy": 0.9, "expected_calibration_error": 0.08, "simulated_share_mae": 0.01}
    )
    assert results == {
        "balanced_accuracy": True,
        "back_view_accuracy": None,
        "expected_calibration_error": False,
        "simulated_share_mae": True,
    }


def test_train_script_installs_a_head_the_runtime_scores_identically(tmp_path: Path) -> None:
    card = train(
        reid="quality",
        train_paths=[cache(tmp_path / "train.npz", 3000, 10)],
        calibration_paths=[cache(tmp_path / "val.npz", 800, 11)],
        test_paths=[cache(tmp_path / "test.npz", 800, 12)],
        models_dir=tmp_path / "models",
        iterations=200,
    )
    head_path = tmp_path / "models" / "sex_head_quality.npz"
    assert (tmp_path / "models" / "sex_head_quality.json").is_file()
    runtime = SexHead.load(head_path)
    assert card["version"] == runtime.version
    assert card["embedding_space"] == SPACE == runtime.embedding_space
    assert card["evaluation"]["balanced_accuracy"] > 0.8
    assert set(card["gates"]) == {
        "balanced_accuracy",
        "back_view_accuracy",
        "expected_calibration_error",
        "simulated_share_mae",
    }
    embeddings, _ = synthetic(20, 13)
    linear = LinearHead(runtime.weights, runtime.bias, runtime.temperature)
    assert [runtime.logit(item) for item in embeddings] == pytest.approx(
        list(linear.logits(embeddings)), rel=1e-4, abs=1e-4
    )
    evaluated = evaluate_caches(runtime, [tmp_path / "test.npz"])
    assert evaluated["balanced_accuracy"] == pytest.approx(card["evaluation"]["balanced_accuracy"])


def test_mixed_embedding_spaces_are_refused(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="embedding space"):
        train(
            reid="fast",
            train_paths=[cache(tmp_path / "a.npz", 100, 1)],
            calibration_paths=[cache(tmp_path / "b.npz", 100, 2, embedding_space="other")],
            test_paths=[],
            models_dir=tmp_path,
        )


def test_build_caches_writes_each_split_and_skips_unreadable_images(tmp_path: Path) -> None:
    rows = [
        ManifestRow(tmp_path / f"{index}.png", index % 2, f"p{index}", "", split)
        for index, split in enumerate(cast(list[Split], ["train", "train", "train", "val", "test"]))
    ]

    def embed_many(paths: list[Path]) -> Iterator[np.ndarray | None]:
        for path in paths:
            yield None if path.name == "1.png" else np.ones(4, dtype=np.float32)

    report = build_caches(
        rows,
        embed_many=embed_many,
        embedding_space=SPACE,
        output_dir=tmp_path / "cache",
        prefix="demo",
        train_limit=3,
    )
    assert report["splits"]["train"] == {
        "images": 2,
        "skipped": 1,
        "female_share": 0.0,
        "path": str(tmp_path / "cache" / "demo_train.npz"),
    }
    loaded = EmbeddingCache.load(tmp_path / "cache" / "demo_train.npz")
    assert loaded.embedding_space == SPACE and loaded.embeddings.shape == (2, 4)


def test_pa100k_reader_uses_official_splits_and_views() -> None:
    names = np.array(["Female", "AgeOver60", "Front", "Side", "Back"], dtype=object).reshape(-1, 1)
    annotation = {"attributes": names}
    for split, labels in (
        ("train", [[1, 0, 1, 0, 0], [0, 0, 0, 0, 1]]),
        ("val", [[0, 0, 0, 1, 0]]),
        ("test", [[1, 0, 0, 0, 0]]),
    ):
        annotation[f"{split}_images_name"] = np.array(
            [np.array([f"{split}{index}.jpg"]) for index in range(len(labels))], dtype=object
        ).reshape(-1, 1)
        annotation[f"{split}_label"] = np.array(labels)
    rows = pa100k_rows(annotation, Path("/data"))
    assert [(row.path.name, row.female, row.view, row.split) for row in rows] == [
        ("train0.jpg", 1, "front", "train"),
        ("train1.jpg", 0, "back", "train"),
        ("val0.jpg", 0, "side", "val"),
        ("test0.jpg", 1, "", "test"),
    ]


def test_rap_v2_reader_uses_one_based_partitions_and_identities() -> None:
    annotation = {
        "name": np.array(["a.png", "b.png", "c.png"], dtype=object),
        "attribute": np.array(["Femal", "face-front", "face-back"], dtype=object),
        "data": np.array([[1, 1, 0], [0, 0, 1], [1, 0, 0]]),
        "person_identity": np.array([7, 7, -1]),
        "partition_attribute": [
            {
                "train_index": np.array([1, 2]),
                "val_index": np.array([]),
                "test_index": np.array([3]),
            }
        ],
    }
    rows = rap_v2_rows(annotation, Path("/rap"))
    assert [(row.path.name, row.female, row.identity, row.view, row.split) for row in rows] == [
        ("a.png", 1, "rap:7", "front", "train"),
        ("b.png", 0, "rap:7", "back", "train"),
        ("c.png", 1, "rap:image:c.png", "", "test"),
    ]


def test_peta_reader_labels_people_and_keeps_each_person_in_one_split(tmp_path: Path) -> None:
    archive = tmp_path / "CUHK" / "archive"
    archive.mkdir(parents=True)
    (archive / "Label.txt").write_text(
        "0001 personalMale upperBodyBlack\n0002 personalFemale hairLong\n0003 upperBodyRed\n"
    )
    for name in ("0001_a.png", "0001_b.png", "0002_a.jpg", "0003_a.png", "notes.txt"):
        (archive / name).write_bytes(b"")
    rows = peta_rows(tmp_path)
    assert [(row.path.name, row.female) for row in rows] == [
        ("0001_a.png", 0),
        ("0001_b.png", 0),
        ("0002_a.jpg", 1),
    ]
    assert len({row.split for row in rows if row.identity.endswith(":0001")}) == 1


def test_manifest_round_trip_and_validation(tmp_path: Path) -> None:
    rows = [ManifestRow(Path("images/x.png"), 1, "p1", "back", "test")]
    path = tmp_path / "labels.csv"
    assert write_manifest(path, rows) == 1
    loaded = read_manifest(path)
    assert loaded[0].path == tmp_path / "images" / "x.png"
    assert (loaded[0].female, loaded[0].view, loaded[0].split) == (1, "back", "test")
    path.write_text("path,female,identity,view,split\nx.png,2,p,,train\n")
    with pytest.raises(ValueError, match="Invalid manifest row"):
        read_manifest(path)


def test_replay_tally_merges_remapped_tracks_and_prefers_quality(tmp_path: Path) -> None:
    fast = write_sex_head(
        tmp_path / "fast.npz",
        embedding_space="fast",
        weights=np.array([2.0, 0.0]),
        bias=0.0,
        temperature=1.0,
    )
    quality = write_sex_head(
        tmp_path / "quality.npz",
        embedding_space="quality",
        weights=np.array([-2.0, 0.0]),
        bias=0.0,
        temperature=1.0,
    )
    tally = TrackSexTally(SexEstimator([fast, quality]))
    vector = np.array([1.0, 0.0], dtype=np.float32)
    tally.add(1, vector, 0.5, "fast")
    tally.add(2, vector, 0.5, "fast")
    tally.add(3, vector, 1.0, "unknown-space")
    tally.remap(2, 1)
    merged = tally.evidence(1, ["quality", "fast"])
    assert merged is not None and merged.weight == pytest.approx(1.0) and merged.logit_sum > 0
    tally.add(1, vector, 1.0, "quality")
    preferred = tally.evidence(1, ["quality", "fast"])
    assert preferred is not None and preferred.logit_sum < 0
    unseen = tally.evidence(9, ["quality", "fast"])
    assert unseen is not None and unseen.weight == 0
    assert tally.evidence(1, ["unknown-space"]) is None


def test_replay_coordinator_reports_counts_for_its_unique_tracks(tmp_path: Path) -> None:
    head = write_sex_head(
        tmp_path / "quality.npz",
        embedding_space="quality",
        weights=np.array([3.0, 0.0]),
        bias=0.0,
        temperature=1.0,
    )
    coordinator = ReplayReIdCoordinator("off", SexEstimator([head]))
    coordinator.quality = SimpleNamespace(embedding_space="quality")  # type: ignore[assignment]
    female, male = np.array([1.0, 0.0]), np.array([-1.0, 0.0])
    for track, vector in ((1, female), (2, female), (3, male)):
        coordinator._sex_tally.add(track, vector, 1.0, "quality")
    result = coordinator.sex_estimate([1, 2, 3, 4])
    assert result["unique_count"] == 4
    assert result["male_count"] + result["female_count"] == 4
    assert result["sex_estimation_state"] == "estimated"


def test_replay_evaluation_separates_unique_error_from_share_error() -> None:
    summary = {
        "video": "walk.mp4",
        "sex_estimate": {
            "unique_count": 8,
            "female_count": 3,
            "male_count": 5,
            "sex_estimation_state": "estimated",
            "sex_evidence_share": 0.75,
        },
    }
    result = evaluate_replay(summary, {"female": 3, "male": 4})
    assert result["unique_count_error"] == 1
    assert result["female_share_error"] == pytest.approx(3 / 8 - 3 / 7)
    with pytest.raises(SystemExit):
        evaluate_replay(
            {"sex_estimate": {"sex_estimation_state": "unavailable"}}, {"female": 1, "male": 1}
        )
