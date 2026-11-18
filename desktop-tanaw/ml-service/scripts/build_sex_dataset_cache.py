"""Embed labelled person images with TANAW's own ReID models, for training the sex head.

Training must see exactly the embeddings the app computes, so this uses the bundled ONNX models
and ``PersonReIdentifier`` preprocessing, not torchreid's Python models.

Examples (datasets live outside the repository, e.g. under $TANAW_DATASETS):

    uv run --with scipy python -m scripts.build_sex_dataset_cache --dataset pa100k \\
        --root "$TANAW_DATASETS/PA-100K/data" --annotation "$TANAW_DATASETS/PA-100K/annotation.mat" \\
        --reid quality --output-dir "$TANAW_DATASETS/cache"

    uv run python -m scripts.build_sex_dataset_cache --dataset manifest \\
        --manifest staged/labels.csv --reid quality --output-dir "$TANAW_DATASETS/cache"
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable, Iterator
from multiprocessing import Pool
from pathlib import Path
from typing import Any, cast

import cv2
import numpy as np

from app.attributes.datasets import (
    SPLITS,
    ManifestRow,
    pa100k_rows,
    peta_rows,
    rap_v2_rows,
    read_manifest,
)
from app.attributes.training import EmbeddingCache
from app.reid import PersonReIdentifier, ReIdModelKey, get_reid_model_profile

SERVICE_ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Embed labelled person images with TANAW's ReID models."
    )
    parser.add_argument("--dataset", choices=["manifest", "pa100k", "rapv2", "peta"], required=True)
    parser.add_argument("--root", type=Path, help="Image folder (PA-100K, RAP v2) or PETA root.")
    parser.add_argument("--annotation", type=Path, help="PA-100K or RAP v2 .mat annotation.")
    parser.add_argument("--manifest", type=Path, help="CSV: path,female,identity,view,split.")
    parser.add_argument("--rap-partition", type=int, default=0)
    parser.add_argument("--reid", choices=["fast", "quality"], default="quality")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--limit", type=int, help="Embed at most this many images per split.")
    parser.add_argument("--train-limit", type=int, help="Override --limit for the train split.")
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="Processes to embed with. Each uses one thread, as the app does, so results match.",
    )
    args = parser.parse_args()

    rows = load_rows(args)
    reidentifier = _load_reidentifier(args.reid)
    embedding_space = reidentifier.embedding_space

    def embed_many(paths: list[Path]) -> Iterator[np.ndarray | None]:
        if args.workers <= 1:
            yield from (_embed(reidentifier, path) for path in paths)
            return
        with Pool(args.workers, initializer=_init_worker, initargs=(args.reid,)) as pool:
            yield from pool.imap(_embed_in_worker, paths, chunksize=32)

    report = build_caches(
        rows,
        embed_many=embed_many,
        embedding_space=embedding_space,
        output_dir=args.output_dir,
        prefix=f"{args.dataset}_{args.reid}",
        limit=args.limit,
        train_limit=args.train_limit,
    )
    print(json.dumps(report, indent=2, sort_keys=True))


def _load_reidentifier(key: str) -> PersonReIdentifier:
    reidentifier = PersonReIdentifier.from_profile(get_reid_model_profile(cast(ReIdModelKey, key)))
    reidentifier.warmup()
    if not reidentifier.status()["reid_model_ready"]:
        raise SystemExit(f"The {key} ReID model is not available.")
    return reidentifier


_WORKER: PersonReIdentifier | None = None


def _init_worker(key: str) -> None:
    global _WORKER
    _WORKER = _load_reidentifier(key)


def _embed_in_worker(path: Path) -> np.ndarray | None:
    assert _WORKER is not None
    return _embed(_WORKER, path)


def load_rows(args: argparse.Namespace) -> list[ManifestRow]:
    if args.dataset == "manifest":
        if args.manifest is None:
            raise SystemExit("--manifest is required.")
        return read_manifest(args.manifest)
    if args.root is None:
        raise SystemExit("--root is required.")
    if args.dataset == "peta":
        return peta_rows(args.root)
    if args.annotation is None:
        raise SystemExit("--annotation is required.")
    try:
        from scipy.io import loadmat  # type: ignore[import-not-found,import-untyped,unused-ignore]
    except ImportError as exc:
        raise SystemExit(
            "Reading .mat annotations needs SciPy: `uv run --with scipy ...`."
        ) from exc
    if args.dataset == "pa100k":
        return pa100k_rows(loadmat(args.annotation), args.root)
    raw = loadmat(args.annotation, squeeze_me=True, struct_as_record=False)["RAP_annotation"]
    annotation: dict[str, Any] = {
        "name": raw.name,
        "attribute": raw.attribute,
        "data": raw.data,
        "person_identity": getattr(raw, "person_identity", np.full(len(raw.name), -1)),
        "partition_attribute": [
            {
                "train_index": item.train_index,
                "val_index": item.val_index,
                "test_index": item.test_index,
            }
            for item in np.atleast_1d(raw.partition_attribute)
        ],
    }
    return rap_v2_rows(annotation, args.root, args.rap_partition)


def build_caches(
    rows: list[ManifestRow],
    *,
    embed_many: Callable[[list[Path]], Iterator[np.ndarray | None]],
    embedding_space: str,
    output_dir: Path,
    prefix: str,
    limit: int | None = None,
    train_limit: int | None = None,
) -> dict[str, Any]:
    """Write one cache per split; unreadable images are counted and skipped."""
    output_dir.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {"embedding_space": embedding_space, "splits": {}}
    for split in SPLITS:
        cap = train_limit if split == "train" and train_limit else limit
        selected = [row for row in rows if row.split == split][: cap or None]
        embeddings: list[np.ndarray] = []
        kept: list[ManifestRow] = []
        skipped = 0
        vectors = embed_many([row.path for row in selected])
        for done, (row, vector) in enumerate(zip(selected, vectors, strict=True), start=1):
            if done % 2000 == 0:
                print(f"{split}: {done}/{len(selected)}", file=sys.stderr, flush=True)
            if vector is None:
                skipped += 1
                continue
            embeddings.append(vector.astype(np.float32))
            kept.append(row)
        if not kept:
            report["splits"][split] = {"images": 0, "skipped": skipped}
            continue
        path = output_dir / f"{prefix}_{split}.npz"
        EmbeddingCache(
            embeddings=np.stack(embeddings),
            female=np.array([row.female for row in kept]),
            identity=np.array([row.identity for row in kept]),
            view=np.array([row.view for row in kept]),
            embedding_space=embedding_space,
        ).save(path)
        report["splits"][split] = {
            "images": len(kept),
            "skipped": skipped,
            "female_share": float(np.mean([row.female for row in kept])),
            "path": str(path),
        }
    return report


def _embed(reidentifier: PersonReIdentifier, path: Path) -> np.ndarray | None:
    image = cv2.imread(str(path))
    if image is None or image.size == 0:
        return None
    result = reidentifier.embed_crop(image)
    return None if result is None else result.embedding


if __name__ == "__main__":
    main()
