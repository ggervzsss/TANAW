from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.attributes import SexHead
from app.detection.yolo_detector import DETECTOR_PROFILES
from app.reid import (
    PersonReIdentifier,
    ReIdModelKey,
    get_reid_model_availability,
    get_reid_model_profile,
    missing_reid_models,
    sex_head_path,
)

SERVICE_ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Verify model assets required by a camera stress-test profile."
    )
    parser.add_argument(
        "--profile",
        choices=["compatibility", "balanced", "high_accuracy", "emergency"],
        default="balanced",
    )
    parser.add_argument("--reid", choices=["off", "fast", "quality"], default="fast")
    parser.add_argument(
        "--require-sex-heads",
        action="store_true",
        help="Fail unless every required ReID model has a matching male/female estimation head.",
    )
    args = parser.parse_args()

    detector = DETECTOR_PROFILES[args.profile]
    detector_path = SERVICE_ROOT / "models" / f"{detector.model_name}.pt"
    missing_reid = missing_reid_models(args.reid, SERVICE_ROOT)
    required_reid_keys: tuple[ReIdModelKey, ...] = (
        () if args.reid == "off" else ("fast",) if args.reid == "fast" else ("fast", "quality")
    )
    reid_runtime: dict[str, dict[str, object]] = {}
    unusable_reid: list[str] = []
    sex_heads: dict[str, dict[str, object]] = {}
    unusable_sex_heads: list[str] = []
    for key in required_reid_keys:
        profile = get_reid_model_profile(key)
        if profile in missing_reid:
            continue
        reidentifier = PersonReIdentifier.from_profile(profile)
        reidentifier.warmup()
        status = reidentifier.status()
        ready = bool(status["reid_model_ready"])
        reid_runtime[key] = {
            "ready": ready,
            "providers": status["reid_providers"],
            "error": status["reid_error"],
        }
        if not ready:
            unusable_reid.append(profile.filename)
        head_path = sex_head_path(key, SERVICE_ROOT)
        head_state: dict[str, object] = {"path": str(head_path), "exists": head_path.is_file()}
        if head_path.is_file():
            try:
                head = SexHead.load(head_path)
                head_state.update(
                    version=head.version,
                    matches_reid_model=head.embedding_space == reidentifier.embedding_space,
                )
            except (OSError, KeyError, ValueError) as exc:
                head_state["error"] = str(exc)
        sex_heads[key] = head_state
        if not head_state.get("matches_reid_model"):
            unusable_sex_heads.append(head_path.name)

    payload = {
        "ready": detector_path.is_file()
        and not missing_reid
        and not unusable_reid
        and not (args.require_sex_heads and unusable_sex_heads),
        "processing_profile": args.profile,
        "detector": {
            "model_name": detector.model_name,
            "path": str(detector_path),
            "exists": detector_path.is_file(),
        },
        "reid_mode": args.reid,
        "reid_models": get_reid_model_availability(SERVICE_ROOT),
        "reid_runtime": reid_runtime,
        "missing": [
            *([] if detector_path.is_file() else [detector_path.name]),
            *(profile.filename for profile in missing_reid),
        ],
        "unusable": unusable_reid,
        "sex_heads": sex_heads,
        "sex_heads_required": args.require_sex_heads,
        "unusable_sex_heads": unusable_sex_heads,
    }
    print(json.dumps(payload, indent=2, sort_keys=True))
    if not payload["ready"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
