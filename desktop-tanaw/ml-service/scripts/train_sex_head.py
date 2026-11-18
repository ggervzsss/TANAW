"""Train, calibrate and install a male/female head for one ReID embedding space.

    uv run python -m scripts.train_sex_head --reid quality \\
        --train cache/pa100k_quality_train.npz cache/rapv2_quality_train.npz \\
        --calibration cache/pa100k_quality_val.npz cache/rapv2_quality_val.npz \\
        --test cache/rapv2_quality_test.npz

Writes ``models/sex_head_<reid>.npz`` (the runtime file) and ``models/sex_head_<reid>.json``
(the model card with metrics and gate results).
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import numpy as np

from app.attributes import write_sex_head
from app.attributes.training import (
    GATES,
    EmbeddingCache,
    LinearHead,
    evaluate_head,
    expected_calibration_error,
    fit_temperature,
    gate_results,
    train_logistic_head,
)
from app.reid import ReIdModelKey, sex_head_path

SERVICE_ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a male/female estimation head.")
    parser.add_argument("--reid", choices=["fast", "quality"], required=True)
    parser.add_argument("--train", type=Path, nargs="+", required=True)
    parser.add_argument("--calibration", type=Path, nargs="+", required=True)
    parser.add_argument("--test", type=Path, nargs="*", default=[])
    parser.add_argument("--l2", type=float, default=1e-4)
    parser.add_argument("--iterations", type=int, default=1500)
    parser.add_argument("--learning-rate", type=float, default=1.0)
    parser.add_argument("--models-dir", type=Path, default=SERVICE_ROOT / "models")
    parser.add_argument(
        "--enforce-gates", action="store_true", help="Exit 1 if a measured gate fails."
    )
    args = parser.parse_args()
    card = train(
        reid=cast(ReIdModelKey, args.reid),
        train_paths=args.train,
        calibration_paths=args.calibration,
        test_paths=args.test,
        models_dir=args.models_dir,
        l2=args.l2,
        iterations=args.iterations,
        learning_rate=args.learning_rate,
    )
    print(json.dumps(card, indent=2, sort_keys=True))
    if args.enforce_gates and any(result is False for result in card["gates"].values()):
        raise SystemExit(1)


def train(
    *,
    reid: ReIdModelKey,
    train_paths: list[Path],
    calibration_paths: list[Path],
    test_paths: list[Path],
    models_dir: Path,
    l2: float = 1e-4,
    iterations: int = 1500,
    learning_rate: float = 1.0,
) -> dict[str, Any]:
    training = EmbeddingCache.concatenate([EmbeddingCache.load(path) for path in train_paths])
    calibration = EmbeddingCache.concatenate(
        [EmbeddingCache.load(path) for path in calibration_paths]
    )
    if calibration.embedding_space != training.embedding_space:
        raise ValueError("Training and calibration caches use different embedding spaces.")
    fitted = train_logistic_head(
        training.embeddings,
        training.female,
        l2=l2,
        iterations=iterations,
        learning_rate=learning_rate,
    )
    raw = fitted.raw_logits(calibration.embeddings)
    temperature = fit_temperature(raw, calibration.female)
    head = LinearHead(weights=fitted.weights, bias=fitted.bias, temperature=temperature)
    evaluation = (
        EmbeddingCache.concatenate([EmbeddingCache.load(path) for path in test_paths])
        if test_paths
        else calibration
    )
    if evaluation.embedding_space != training.embedding_space:
        raise ValueError("Test caches use a different embedding space.")
    metrics = evaluate_head(
        head,
        evaluation.embeddings,
        evaluation.female,
        identities=evaluation.identity,
        views=evaluation.view,
    )
    head_path = models_dir / sex_head_path(reid).name
    installed = write_sex_head(
        head_path,
        embedding_space=training.embedding_space,
        weights=head.weights,
        bias=head.bias,
        temperature=head.temperature,
    )
    card: dict[str, Any] = {
        "created_at": datetime.now(UTC).isoformat(),
        "reid": reid,
        "embedding_space": training.embedding_space,
        "version": installed.version,
        "head_path": head_path.name,
        "temperature": temperature,
        "l2": l2,
        "iterations": iterations,
        "learning_rate": learning_rate,
        "training": {
            "caches": [path.name for path in train_paths],
            "images": int(training.female.size),
            "female_share": float(training.female.mean()),
        },
        "calibration": {
            "caches": [path.name for path in calibration_paths],
            "images": int(calibration.female.size),
            "ece_before": expected_calibration_error(1 / (1 + np.exp(-raw)), calibration.female),
        },
        "evaluation": {
            "caches": [path.name for path in test_paths] or "calibration split",
            **metrics,
        },
        "gate_thresholds": GATES,
        "gates": gate_results(metrics),
    }
    head_path.with_suffix(".json").write_text(json.dumps(card, indent=2, sort_keys=True), "utf8")
    return card


if __name__ == "__main__":
    main()
