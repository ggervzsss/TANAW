from __future__ import annotations

import argparse
import os
import shutil
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODELS_DIR = SERVICE_ROOT / "models"


@dataclass(frozen=True)
class DetectorModel:
    name: str
    openvino_image_sizes: tuple[int, ...]
    legacy: bool = False

    @property
    def filename(self) -> str:
        return f"{self.name}.pt"

    def openvino_dirname(self, image_size: int) -> str:
        return f"{self.name}_{image_size}_openvino_model"


DETECTOR_MODELS: dict[str, DetectorModel] = {
    "yolo11n": DetectorModel("yolo11n", (480, 640)),
    "yolo11s": DetectorModel("yolo11s", (640,)),
    "yolo11m": DetectorModel("yolo11m", (640,)),
    "yolov8n": DetectorModel("yolov8n", (480,), legacy=True),
    "yolov8s": DetectorModel("yolov8s", (640,), legacy=True),
}
DEFAULT_DOWNLOADS = ("yolo11n", "yolo11s")


def main() -> None:
    args = _parse_args()
    models = _selected_models(
        args.models,
        include_high_accuracy=args.include_high_accuracy,
        include_legacy=args.include_legacy,
    )
    models_dir = args.models_dir.resolve()
    models_dir.mkdir(parents=True, exist_ok=True)

    for model in models:
        _ensure_model(model, models_dir=models_dir, force=args.force)

    if args.export_openvino:
        _export_openvino(models, models_dir=models_dir, force=args.force)

    print("Detector model setup complete.")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download TANAW desktop YOLO11 detector models into ml-service/models."
    )
    parser.add_argument(
        "--models",
        nargs="+",
        choices=tuple(DETECTOR_MODELS),
        default=list(DEFAULT_DOWNLOADS),
        help="Detector model weights to download. Defaults to yolo11n yolo11s.",
    )
    parser.add_argument(
        "--include-high-accuracy",
        action="store_true",
        help="Also ensure yolo11m.pt exists for high-accuracy testing.",
    )
    parser.add_argument(
        "--include-legacy",
        action="store_true",
        help="Also ensure yolov8n.pt and yolov8s.pt exist as legacy fallback assets.",
    )
    parser.add_argument(
        "--export-openvino",
        action="store_true",
        help="Export selected weights to size-specific OpenVINO folders.",
    )
    parser.add_argument(
        "--models-dir",
        type=Path,
        default=DEFAULT_MODELS_DIR,
        help="Directory where detector assets should be stored.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download weights and regenerate exports even when files already exist.",
    )
    return parser.parse_args()


def _selected_models(
    model_names: Iterable[str], *, include_high_accuracy: bool, include_legacy: bool
) -> list[DetectorModel]:
    selected = list(dict.fromkeys(model_names))
    if include_high_accuracy and "yolo11m" not in selected:
        selected.append("yolo11m")
    if include_legacy:
        for model_name in ("yolov8n", "yolov8s"):
            if model_name not in selected:
                selected.append(model_name)
    return [DETECTOR_MODELS[name] for name in selected]


def _ensure_model(model: DetectorModel, *, models_dir: Path, force: bool) -> None:
    destination = models_dir / model.filename
    if destination.exists() and not force:
        print(f"{destination.name} already exists; skipping download.")
        return

    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise RuntimeError(
            "Detector setup requires ultralytics. Run through `uv run python`."
        ) from exc

    if destination.exists() and force:
        destination.unlink()

    print(f"Resolving {model.filename} with Ultralytics...")
    previous_cwd = Path.cwd()
    try:
        os.chdir(models_dir)
        YOLO(model.filename)
    finally:
        os.chdir(previous_cwd)

    if not destination.exists():
        raise RuntimeError(
            f"Ultralytics did not create {destination}. Check network access and package support."
        )
    print(f"Saved {destination.relative_to(models_dir.parent)}.")


def _export_openvino(models: Iterable[DetectorModel], *, models_dir: Path, force: bool) -> None:
    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise RuntimeError(
            "OpenVINO export requires ultralytics. Run this script through `uv run python`."
        ) from exc

    for model in models:
        source_path = models_dir / model.filename
        if not source_path.exists():
            raise RuntimeError(f"Cannot export {model.name}; missing {source_path}.")

        for image_size in model.openvino_image_sizes:
            export_dir = models_dir / model.openvino_dirname(image_size)
            if export_dir.exists():
                if not force:
                    print(f"{export_dir.name} already exists; skipping export.")
                    continue
                shutil.rmtree(export_dir)

            generated_dir = models_dir / f"{model.name}_openvino_model"
            if generated_dir.exists():
                shutil.rmtree(generated_dir)

            print(f"Exporting {model.name} at {image_size}px to OpenVINO...")
            previous_cwd = Path.cwd()
            try:
                os.chdir(models_dir)
                YOLO(str(source_path)).export(format="openvino", imgsz=image_size)
            finally:
                os.chdir(previous_cwd)

            if not generated_dir.exists():
                raise RuntimeError(f"OpenVINO export did not create {generated_dir}.")
            generated_dir.replace(export_dir)
            print(f"Saved {export_dir.relative_to(models_dir.parent)}.")


if __name__ == "__main__":
    main()
