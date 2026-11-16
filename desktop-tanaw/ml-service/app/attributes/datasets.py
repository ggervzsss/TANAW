"""Read sex labels from public pedestrian-attribute datasets into one manifest format.

Datasets are downloaded by the developer outside the repository and never bundled. Parsers
take already-loaded annotation structures so they are testable without SciPy or the data;
``scripts/build_sex_dataset_cache.py`` does the file loading.

Labels: female = 1, male = 0. Views are normalised to "front", "back", "side" or "".
"""

from __future__ import annotations

import csv
import hashlib
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, cast

import numpy as np

Split = Literal["train", "val", "test"]
SPLITS: tuple[Split, ...] = ("train", "val", "test")
MANIFEST_FIELDS = ("path", "female", "identity", "view", "split")


@dataclass(frozen=True)
class ManifestRow:
    path: Path
    female: int
    identity: str
    view: str
    split: Split


def strings(value: Any) -> list[str]:
    """Flatten MATLAB cell arrays (nested object arrays) into a list of strings."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, bytes):
        return [value.decode()]
    array = np.asarray(value, dtype=object)
    if array.ndim == 0:
        item = array.item()
        return strings(item) if not isinstance(item, (str, bytes)) else strings(item)
    result: list[str] = []
    for item in array.reshape(-1):
        result.extend(strings(item))
    return result


def _split_for(identity: str, seed: str = "tanaw-sex") -> Split:
    """Deterministic 80/10/10 split by identity, so one person never spans two splits."""
    bucket = int(hashlib.sha256(f"{seed}:{identity}".encode()).hexdigest()[:8], 16) % 10
    return "test" if bucket == 0 else "val" if bucket == 1 else "train"


def _view(names: Sequence[str], row: np.ndarray, mapping: Mapping[str, str]) -> str:
    for index, name in enumerate(names):
        view = mapping.get(name)
        if view is not None and row[index]:
            return view
    return ""


def pa100k_rows(annotation: Mapping[str, Any], image_root: Path) -> list[ManifestRow]:
    """PA-100K ``annotation.mat``: official train/val/test lists; one image per identity."""
    attributes = strings(annotation["attributes"])
    female_index = attributes.index("Female")
    views = {"Front": "front", "Back": "back", "Side": "side"}
    rows: list[ManifestRow] = []
    for split in SPLITS:
        names = strings(annotation[f"{split}_images_name"])
        labels = np.asarray(annotation[f"{split}_label"])
        if labels.shape[0] != len(names):
            raise ValueError(f"PA-100K {split} names and labels differ in length.")
        for name, label in zip(names, labels, strict=True):
            rows.append(
                ManifestRow(
                    path=image_root / name,
                    female=int(label[female_index] == 1),
                    identity=f"pa100k:{name}",
                    view=_view(attributes, label, views),
                    split=split,
                )
            )
    return rows


def rap_v2_rows(
    annotation: Mapping[str, Any], image_root: Path, partition: int = 0
) -> list[ManifestRow]:
    """RAP v2 ``RAP_annotation``: one of its official partitions; indexes are 1-based.

    ``annotation`` holds ``name``, ``attribute``, ``data``, ``person_identity`` and
    ``partition_attribute`` (a sequence of mappings with ``train_index``, ``val_index`` and
    ``test_index``). Images whose person identity is unknown keep a per-image identity.
    """
    names = strings(annotation["name"])
    attributes = strings(annotation["attribute"])
    data = np.asarray(annotation["data"])
    female_index = (
        attributes.index("Femal") if "Femal" in attributes else attributes.index("Female")
    )
    views = {"face-front": "front", "face-back": "back", "face-left": "side", "face-right": "side"}
    identities = np.asarray(annotation.get("person_identity", np.full(len(names), -1))).reshape(-1)
    chosen = annotation["partition_attribute"][partition]
    rows: list[ManifestRow] = []
    for split in SPLITS:
        for index in np.asarray(chosen[f"{split}_index"]).reshape(-1):
            position = int(index) - 1
            label = data[position]
            identity = int(identities[position]) if position < identities.size else -1
            rows.append(
                ManifestRow(
                    path=image_root / names[position],
                    female=int(label[female_index] == 1),
                    identity=f"rap:{identity}" if identity >= 0 else f"rap:image:{names[position]}",
                    view=_view(attributes, label, views),
                    split=split,
                )
            )
    return rows


def peta_rows(root: Path) -> list[ManifestRow]:
    """PETA: ``<subset>/archive/Label.txt`` lines start with a person ID followed by attributes.

    Images are named ``<person id>_...``. PETA has no official split here, so identities are
    split 80/10/10 deterministically. Rows without ``personalMale``/``personalFemale`` are skipped.
    """
    rows: list[ManifestRow] = []
    for label_file in sorted(root.glob("*/archive/Label.txt")):
        archive = label_file.parent
        labels: dict[str, int] = {}
        for line in label_file.read_text(encoding="utf8", errors="replace").splitlines():
            parts = line.split()
            if len(parts) < 2:
                continue
            if "personalFemale" in parts[1:]:
                labels[parts[0]] = 1
            elif "personalMale" in parts[1:]:
                labels[parts[0]] = 0
        for image in sorted(archive.iterdir()):
            if image.suffix.lower() not in {".png", ".jpg", ".jpeg", ".bmp"}:
                continue
            person = image.name.split("_", 1)[0]
            if person not in labels:
                continue
            identity = f"peta:{archive.parent.name}:{person}"
            rows.append(
                ManifestRow(
                    path=image,
                    female=labels[person],
                    identity=identity,
                    view="",
                    split=_split_for(identity),
                )
            )
    return rows


def write_manifest(path: Path, rows: Iterable[ManifestRow]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", newline="", encoding="utf8") as handle:
        writer = csv.DictWriter(handle, fieldnames=MANIFEST_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "path": str(row.path),
                    "female": row.female,
                    "identity": row.identity,
                    "view": row.view,
                    "split": row.split,
                }
            )
            count += 1
    return count


def read_manifest(path: Path) -> list[ManifestRow]:
    """A CSV with ``path,female,identity,view,split``; relative paths resolve from the CSV."""
    rows: list[ManifestRow] = []
    with path.open(newline="", encoding="utf8") as handle:
        for record in csv.DictReader(handle):
            female = record["female"].strip()
            split = record["split"].strip()
            if female not in {"0", "1"} or split not in SPLITS:
                raise ValueError(f"Invalid manifest row: {record}")
            image = Path(record["path"])
            rows.append(
                ManifestRow(
                    path=image if image.is_absolute() else path.parent / image,
                    female=int(female),
                    identity=record.get("identity") or record["path"],
                    view=(record.get("view") or "").strip(),
                    split=cast(Split, split),
                )
            )
    return rows
