from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.runtime.assets import model_directory

ReIdModelKey = Literal["fast", "quality"]
ReIdReplayMode = Literal["off", "fast", "quality"]


@dataclass(frozen=True)
class ReIdModelProfile:
    key: ReIdModelKey
    filename: str
    model_name: str
    input_size: tuple[int, int]
    role: str

    def path(self, service_root: Path | None = None) -> Path:
        return (service_root / "models" if service_root else model_directory()) / self.filename


REID_MODEL_PROFILES: dict[ReIdModelKey, ReIdModelProfile] = {
    "fast": ReIdModelProfile(
        key="fast",
        filename="person_reid_cpu.onnx",
        model_name="torchreid_osnet_x0_25_msmt17_onnx",
        input_size=(128, 256),
        role="low-latency appearance association",
    ),
    "quality": ReIdModelProfile(
        key="quality",
        filename="person_reid.onnx",
        model_name="torchreid_osnet_ain_x1_0_msmt17_onnx",
        input_size=(128, 256),
        role="higher-accuracy ambiguous track association and unique-visitor confirmation",
    ),
}


def get_reid_model_profile(key: ReIdModelKey) -> ReIdModelProfile:
    return REID_MODEL_PROFILES[key]


def get_reid_model_availability(
    service_root: Path | None = None,
) -> dict[str, dict[str, bool | str | list[int]]]:
    availability: dict[str, dict[str, bool | str | list[int]]] = {}
    for key, profile in REID_MODEL_PROFILES.items():
        path = profile.path(service_root)
        availability[key] = {
            "path": str(path),
            "exists": path.is_file(),
            "required": True,
            "model_name": profile.model_name,
            "input_size": list(profile.input_size),
            "role": profile.role,
        }
    return availability


def missing_reid_models(
    mode: ReIdReplayMode,
    service_root: Path | None = None,
) -> list[ReIdModelProfile]:
    required_keys: tuple[ReIdModelKey, ...]
    if mode == "off":
        required_keys = ()
    elif mode == "fast":
        required_keys = ("fast",)
    else:
        required_keys = ("fast", "quality")
    return [
        REID_MODEL_PROFILES[key]
        for key in required_keys
        if not REID_MODEL_PROFILES[key].path(service_root).is_file()
    ]
