"""Measure a male/female head on held-out data or on a replayed recording.

Held-out dataset caches (accuracy, calibration, simulated daily share error, gates):

    uv run python -m scripts.evaluate_sex_estimator --head models/sex_head_quality.npz \\
        --cache cache/rapv2_quality_test.npz --enforce-gates

A replayed recording with known ground truth (e.g. a staged walk-through):

    uv run python -m scripts.replay_tracking --video walk.mp4 --output walk.jsonl \\
        --summary-output walk.json --reid quality
    uv run python -m scripts.evaluate_sex_estimator --replay-summary walk.json \\
        --truth walk-truth.json      # {"female": 3, "male": 4}
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from app.attributes import SexHead
from app.attributes.training import (
    GATES,
    EmbeddingCache,
    LinearHead,
    evaluate_head,
    gate_results,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate male/female estimation.")
    parser.add_argument("--head", type=Path, help="Runtime head file (sex_head_<reid>.npz).")
    parser.add_argument("--cache", type=Path, nargs="*", default=[])
    parser.add_argument("--replay-summary", type=Path, help="replay_tracking --summary-output.")
    parser.add_argument("--truth", type=Path, help='JSON with {"female": n, "male": n}.')
    parser.add_argument("--output", type=Path, help="Also write the result as JSON here.")
    parser.add_argument("--enforce-gates", action="store_true")
    args = parser.parse_args()

    if args.replay_summary is not None:
        if args.truth is None:
            raise SystemExit("--truth is required with --replay-summary.")
        result = evaluate_replay(
            json.loads(args.replay_summary.read_text("utf8")),
            json.loads(args.truth.read_text("utf8")),
        )
    else:
        if args.head is None or not args.cache:
            raise SystemExit("--head and --cache are required.")
        result = evaluate_caches(SexHead.load(args.head), args.cache)
    text = json.dumps(result, indent=2, sort_keys=True)
    if args.output is not None:
        args.output.write_text(text, "utf8")
    print(text)
    if args.enforce_gates and any(value is False for value in result.get("gates", {}).values()):
        raise SystemExit(1)


def evaluate_caches(head: SexHead, paths: list[Path]) -> dict[str, Any]:
    cache = EmbeddingCache.concatenate([EmbeddingCache.load(path) for path in paths])
    if cache.embedding_space != head.embedding_space:
        raise SystemExit(
            f"The head was trained for {head.embedding_space}, the cache uses {cache.embedding_space}."
        )
    linear = LinearHead(weights=head.weights, bias=head.bias, temperature=head.temperature)
    metrics = evaluate_head(
        linear, cache.embeddings, cache.female, identities=cache.identity, views=cache.view
    )
    return {
        "head": head.version,
        "caches": [str(path) for path in paths],
        **metrics,
        "gate_thresholds": GATES,
        "gates": gate_results(metrics),
    }


def evaluate_replay(summary: dict[str, Any], truth: dict[str, Any]) -> dict[str, Any]:
    """Compare a replay's estimated totals with the people known to be in the recording."""
    estimate = summary.get("sex_estimate") or {}
    if estimate.get("sex_estimation_state") != "estimated":
        raise SystemExit("The replay has no male/female estimate; install heads and replay again.")
    female, male = int(truth["female"]), int(truth["male"])
    people = female + male
    unique = int(estimate["unique_count"])
    estimated_female = int(estimate["female_count"])
    return {
        "video": summary.get("video"),
        "true_female": female,
        "true_male": male,
        "estimated_unique": unique,
        "estimated_female": estimated_female,
        "estimated_male": int(estimate["male_count"]),
        # Unique counting errors are reported separately from the male/female split.
        "unique_count_error": unique - people,
        "true_female_share": female / people if people else None,
        "estimated_female_share": estimated_female / unique if unique else None,
        "female_share_error": (estimated_female / unique - female / people)
        if unique and people
        else None,
        "evidence_share": estimate.get("sex_evidence_share"),
    }


if __name__ == "__main__":
    main()
