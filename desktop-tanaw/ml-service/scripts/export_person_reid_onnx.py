# pyright: reportMissingImports=false
"""Export TANAW's pinned OSNet ReID profiles to ONNX.

The exported files are committed in git, because the male/female heads in ``models/`` only accept
the exact ReID file they were trained on and a re-export differs byte for byte. So an existing
file is kept, and ``--force`` replaces it only when the heads will be retrained afterwards.
"""

import argparse
from collections.abc import Mapping
from pathlib import Path
from tempfile import gettempdir
from typing import Any, Literal

from app.attributes import SexHead
from app.reid import ReIdModelKey, sex_head_path
from app.reid.person_reid import model_artifact_digest

INPUT_HEIGHT = 256
INPUT_WIDTH = 128
MODEL_PROFILES = {
    "cpu": {
        "model_name": "osnet_x0_25",
        "model_source": "torchreid_osnet_x0_25_msmt17",
        "google_drive_file_id": "1Kkx2zW89jq_NETu4u42CFZTMVD5Hwm6e",
        "output_name": "person_reid_cpu.onnx",
        "reid_key": "fast",
    },
    "quality": {
        "model_name": "osnet_ain_x1_0",
        "model_source": "torchreid_osnet_ain_x1_0_msmt17",
        "google_drive_file_id": "1SigwBE6mPdqiJMqhuIY4aqC7--5CsMal",
        "output_name": "person_reid.onnx",
        "reid_key": "quality",
    },
}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download and export TANAW's pinned OSNet ReID profiles to ONNX."
    )
    parser.add_argument(
        "--profile",
        choices=[*sorted(MODEL_PROFILES), "all"],
        default="all",
        help="Profile to export. Defaults to both required profiles.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-export even if the file exists. The male/female heads must then be retrained.",
    )
    args = parser.parse_args()

    service_root = Path(__file__).resolve().parents[1]
    models_dir = service_root / "models"
    models_dir.mkdir(parents=True, exist_ok=True)

    selected_profiles = (
        list(MODEL_PROFILES.values()) if args.profile == "all" else [MODEL_PROFILES[args.profile]]
    )
    for profile in selected_profiles:
        _export_profile(profile, models_dir, force=args.force)
    print("ReID model setup complete.")


ExportDecision = Literal["export", "skip"]


def expected_digest(reid_key: ReIdModelKey, models_dir: Path) -> str | None:
    """SHA-256 of the ReID file the trained male/female head expects, or None without a head."""
    path = sex_head_path(reid_key, models_dir.parent)
    if not path.is_file():
        return None
    try:
        embedding_space = SexHead.load(path).embedding_space
    except (OSError, ValueError, KeyError):
        return None
    _, _, rest = embedding_space.partition("@")
    digest = rest.split(":", 1)[0]
    return digest or None


def decide_export(
    output_path: Path, reid_key: ReIdModelKey, *, force: bool
) -> tuple[ExportDecision, str]:
    """Whether to export, and the message to print. Existing files are never replaced silently."""
    expected = expected_digest(reid_key, output_path.parent)
    if force:
        message = f"Exporting {output_path.name} (--force)."
        if expected is not None:
            message += (
                " WARNING: the new file will not match the trained male/female head"
                f" ({sex_head_path(reid_key, output_path.parent.parent).name}); retrain it with"
                " scripts.train_sex_head, or male/female estimates stay unavailable."
            )
        return "export", message
    if not output_path.is_file():
        return "export", f"{output_path.name} is missing; exporting."
    if expected is None:
        return "skip", f"{output_path.name} already exists; skipping export."
    actual = model_artifact_digest(output_path)
    if actual == expected:
        return "skip", (
            f"{output_path.name} matches the trained male/female head"
            f" (sha256 {actual[:16]}…); skipping export."
        )
    return "skip", (
        f"WARNING: {output_path.name} does not match the trained male/female head"
        f" (expected sha256 {expected[:16]}…, found {actual[:16]}…), so male/female estimates"
        f" are unavailable. Restore the committed file with `git checkout --"
        f" ml-service/models/{output_path.name}`; skipping export."
    )


def _export_profile(profile: Mapping[str, Any], models_dir: Path, *, force: bool) -> None:
    output_path = models_dir / profile["output_name"]
    decision, message = decide_export(output_path, profile["reid_key"], force=force)
    print(message)
    if decision == "skip":
        return
    _export_onnx(profile, output_path)


def _export_onnx(profile: Mapping[str, Any], output_path: Path) -> None:
    # Export-only dependencies (`--group export`); imported here so the checks above run without.
    import onnx
    import torch
    import torch.nn.functional as F
    from gdown.download import download
    from torch import nn
    from torchreid import models, utils

    class NormalizedFeatureExtractor(nn.Module):
        def __init__(self, backbone: nn.Module) -> None:
            super().__init__()
            self.backbone = backbone

        def forward(self, image: torch.Tensor) -> torch.Tensor:
            embedding = self.backbone(image)
            return F.normalize(embedding, p=2, dim=1)

    checkpoint_dir = Path(gettempdir()) / "tanaw-reid-export"
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_path = checkpoint_dir / f"{profile['model_source']}.pth"
    if not checkpoint_path.exists():
        print(f"Downloading {profile['model_source']} checkpoint...")
        download(id=profile["google_drive_file_id"], output=str(checkpoint_path), quiet=False)

    backbone = models.build_model(
        name=profile["model_name"], num_classes=1000, pretrained=False, use_gpu=False
    )
    utils.load_pretrained_weights(backbone, str(checkpoint_path))
    backbone.eval()

    model = NormalizedFeatureExtractor(backbone).eval()
    dummy_input = torch.zeros((1, 3, INPUT_HEIGHT, INPUT_WIDTH), dtype=torch.float32)
    torch.onnx.export(
        model,
        (dummy_input,),
        str(output_path),
        input_names=["person_image"],
        output_names=["reid_embedding"],
        dynamic_axes={
            "person_image": {0: "batch"},
            "reid_embedding": {0: "batch"},
        },
        opset_version=18,
        do_constant_folding=True,
        external_data=False,
        verbose=False,
    )

    onnx_model = onnx.load(str(output_path))
    onnx.checker.check_model(onnx_model)
    print(f"Exported {output_path}")


if __name__ == "__main__":
    main()
