"""Run real CPU inference from the installed runtime without camera/cloud writes."""

import json

import lap  # type: ignore[import-untyped]
import numpy as np

from app.detection.detector_selection import DETECTOR_PROFILES
from app.reid import PersonReIdentifier, get_reid_model_profile
from app.runtime.assets import model_directory
from app.runtime.config_directories import configure_third_party_directories


def verify_models() -> None:
    configure_third_party_directories()
    from ultralytics import YOLO

    models = model_directory()
    checked: list[str] = []
    # Exercise native tracker assignment even when the blank inference image
    # contains no people. No driver or GPU is used in this diagnostic.
    lap.lapjv(np.array([[0.0, 1.0], [1.0, 0.0]]))
    for profile in DETECTOR_PROFILES.values():
        for filename in (
            f"{profile.model_name}.pt",
            f"{profile.model_name}_{profile.image_size}_openvino_model",
        ):
            if filename in checked:
                continue
            source = models / filename
            if not source.exists():
                raise FileNotFoundError(f"Required bundled model is missing: {source}")
            if source.is_dir():
                for required in (
                    "metadata.yaml",
                    f"{profile.model_name}.xml",
                    f"{profile.model_name}.bin",
                ):
                    if not (source / required).is_file():
                        raise FileNotFoundError(
                            f"Required OpenVINO asset is missing: {source / required}"
                        )
            detector = YOLO(str(source), task="detect")
            results = detector.predict(
                np.zeros((profile.image_size, profile.image_size, 3), dtype=np.uint8),
                imgsz=profile.image_size,
                device="cpu",
                verbose=False,
            )
            if len(results) != 1 or results[0].boxes is None:
                raise RuntimeError(f"CPU detector inference failed: {filename}")
            checked.append(filename)
            del detector, results
    for reid_profile in (get_reid_model_profile("fast"), get_reid_model_profile("quality")):
        reidentifier = PersonReIdentifier.from_profile(reid_profile)
        reidentifier.warmup()
        status = reidentifier.status()
        if not status["reid_model_ready"] or status["reid_error"]:
            raise RuntimeError(
                f"ReID inference failed: {reid_profile.filename}: {status['reid_error']}"
            )
        checked.append(reid_profile.filename)
    print(json.dumps({"ready": True, "device": "cpu", "native_tracker": True, "models": checked}))
