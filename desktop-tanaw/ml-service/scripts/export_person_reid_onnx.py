# pyright: reportMissingImports=false
import argparse
from collections.abc import Mapping
from pathlib import Path
from tempfile import gettempdir
from typing import Any

import onnx
import torch
import torch.nn.functional as F
from gdown.download import download
from torch import nn
from torchreid import models, utils

INPUT_HEIGHT = 256
INPUT_WIDTH = 128
MODEL_PROFILES = {
    "cpu": {
        "model_name": "osnet_x0_25",
        "model_source": "torchreid_osnet_x0_25_msmt17",
        "google_drive_file_id": "1Kkx2zW89jq_NETu4u42CFZTMVD5Hwm6e",
        "output_name": "person_reid_cpu.onnx",
    },
    "quality": {
        "model_name": "osnet_ain_x1_0",
        "model_source": "torchreid_osnet_ain_x1_0_msmt17",
        "google_drive_file_id": "1SigwBE6mPdqiJMqhuIY4aqC7--5CsMal",
        "output_name": "person_reid.onnx",
    },
}


class NormalizedFeatureExtractor(nn.Module):
    def __init__(self, backbone: nn.Module) -> None:
        super().__init__()
        self.backbone = backbone

    def forward(self, image: torch.Tensor) -> torch.Tensor:
        embedding = self.backbone(image)
        return F.normalize(embedding, p=2, dim=1)


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
    parser.add_argument("--force", action="store_true")
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


def _export_profile(profile: Mapping[str, Any], models_dir: Path, *, force: bool) -> None:
    checkpoint_dir = Path(gettempdir()) / "tanaw-reid-export"
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_path = checkpoint_dir / f"{profile['model_source']}.pth"
    output_path = models_dir / profile["output_name"]

    if output_path.is_file() and not force:
        print(f"{output_path.name} already exists; skipping export.")
        return

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
    )

    onnx_model = onnx.load(str(output_path))
    onnx.checker.check_model(onnx_model)
    print(f"Exported {output_path}")


if __name__ == "__main__":
    main()
