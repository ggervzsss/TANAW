from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PROCESSING_PROFILE_VALUES = {
    "auto",
    "compatibility",
    "balanced",
    "high_accuracy",
    "emergency",
}
RUNTIME_BACKEND_VALUES = {"auto", "cuda", "openvino", "cpu"}
TRACKER_PROFILE_VALUES = {"auto", "bytetrack", "botsort"}


@dataclass(frozen=True)
class DetectorProfile:
    name: str
    model_name: str
    image_size: int
    nms_iou: float
    max_detections: int
    preferred_runtimes: tuple[str, ...]
    target_processing_fps: float | None
    default_tracker: str
    default_reid_mode: str
    role: str
    optional: bool = False


@dataclass(frozen=True)
class DetectorSelection:
    requested_profile: str
    normalized_profile: str
    effective_profile: str
    model_name: str
    model_path: str | None
    runtime_backend: str
    requested_runtime: str
    requested_tracker: str
    effective_tracker: str
    tracker_config_path: str
    image_size: int
    nms_iou: float
    max_detections: int
    target_processing_fps: float | None
    selection_reason: str
    fallback_reason: str | None
    fallback_chain: tuple[str, ...]


DETECTOR_PROFILES: dict[str, DetectorProfile] = {
    "emergency": DetectorProfile(
        name="emergency",
        model_name="yolo11n",
        image_size=480,
        nms_iou=0.45,
        max_detections=32,
        preferred_runtimes=("openvino", "cpu", "cuda"),
        target_processing_fps=7.0,
        default_tracker="bytetrack",
        default_reid_mode="off",
        role="lowest-resource emergency fallback",
    ),
    "compatibility": DetectorProfile(
        name="compatibility",
        model_name="yolo11n",
        image_size=640,
        nms_iou=0.50,
        max_detections=64,
        preferred_runtimes=("cuda", "openvino", "cpu"),
        target_processing_fps=9.0,
        default_tracker="bytetrack",
        default_reid_mode="off",
        role="safe CPU and weaker-device profile",
    ),
    "balanced": DetectorProfile(
        name="balanced",
        model_name="yolo11s",
        image_size=640,
        nms_iou=0.55,
        max_detections=96,
        preferred_runtimes=("cuda", "openvino", "cpu"),
        target_processing_fps=12.0,
        default_tracker="botsort",
        default_reid_mode="fast",
        role="recommended capable-device profile",
    ),
    "high_accuracy": DetectorProfile(
        name="high_accuracy",
        model_name="yolo11m",
        image_size=640,
        nms_iou=0.55,
        max_detections=128,
        preferred_runtimes=("cuda", "openvino", "cpu"),
        target_processing_fps=12.0,
        default_tracker="botsort",
        default_reid_mode="fast",
        role="higher-accuracy dedicated GPU profile",
        optional=True,
    ),
}

PROFILE_FALLBACKS: dict[str, tuple[str, ...]] = {
    "emergency": ("emergency",),
    "compatibility": ("compatibility", "emergency"),
    "balanced": ("balanced", "compatibility", "emergency"),
    "high_accuracy": ("high_accuracy", "balanced", "compatibility", "emergency"),
}

TrackerConfigResolver = Callable[[str, str], Path]


def select_detector(
    *,
    processing_profile: str,
    runtime_backend: str,
    tracker_profile: str,
    capabilities: dict[str, Any],
    models_root: Path,
    tracker_config_path: TrackerConfigResolver,
) -> DetectorSelection:
    requested_profile = processing_profile if processing_profile else "auto"
    requested_runtime = runtime_backend if runtime_backend in RUNTIME_BACKEND_VALUES else "auto"
    requested_tracker = tracker_profile if tracker_profile in TRACKER_PROFILE_VALUES else "auto"
    normalized_profile = _normalize_processing_profile(requested_profile)

    if normalized_profile == "auto":
        starting_profile, selection_reason = _auto_profile(capabilities)
    else:
        starting_profile = normalized_profile
        selection_reason = f"Using requested {starting_profile} model profile."

    fallback_chain = PROFILE_FALLBACKS.get(starting_profile, ("compatibility", "emergency"))
    fallback_notes: list[str] = []
    for profile_name in fallback_chain:
        profile = DETECTOR_PROFILES[profile_name]
        for runtime in _runtime_candidates(profile, requested_runtime, capabilities):
            model_path = _first_existing_model_path(profile_name, runtime, models_root)
            if model_path is None:
                continue
            tracker, config_path, tracker_note = _resolve_tracker(
                profile_name, requested_tracker, tracker_config_path
            )
            if tracker_note is not None:
                fallback_notes.append(tracker_note)
            if profile_name != starting_profile:
                fallback_notes.append(
                    f"{DETECTOR_PROFILES[starting_profile].model_name} was unavailable; "
                    f"using {profile.model_name}."
                )
            if requested_runtime != "auto" and runtime != requested_runtime:
                fallback_notes.append(
                    f"Requested {requested_runtime} runtime was unavailable; using {runtime}."
                )
            return DetectorSelection(
                requested_profile=requested_profile,
                normalized_profile=normalized_profile,
                effective_profile=profile_name,
                model_name=profile.model_name,
                model_path=str(model_path),
                runtime_backend=runtime,
                requested_runtime=requested_runtime,
                requested_tracker=requested_tracker,
                effective_tracker=tracker,
                tracker_config_path=str(config_path),
                image_size=profile.image_size,
                nms_iou=profile.nms_iou,
                max_detections=profile.max_detections,
                target_processing_fps=profile.target_processing_fps,
                selection_reason=selection_reason,
                fallback_reason=" ".join(fallback_notes) or None,
                fallback_chain=_visible_fallback_chain(fallback_chain, profile_name),
            )
        fallback_notes.append(f"{profile.model_name} has no available model for usable runtimes.")

    profile = DETECTOR_PROFILES[starting_profile]
    tracker, config_path, tracker_note = _resolve_tracker(
        starting_profile, requested_tracker, tracker_config_path
    )
    if tracker_note is not None:
        fallback_notes.append(tracker_note)
    return DetectorSelection(
        requested_profile=requested_profile,
        normalized_profile=normalized_profile,
        effective_profile=starting_profile,
        model_name=profile.model_name,
        model_path=None,
        runtime_backend="cpu",
        requested_runtime=requested_runtime,
        requested_tracker=requested_tracker,
        effective_tracker=tracker,
        tracker_config_path=str(config_path),
        image_size=profile.image_size,
        nms_iou=profile.nms_iou,
        max_detections=profile.max_detections,
        target_processing_fps=profile.target_processing_fps,
        selection_reason=selection_reason,
        fallback_reason=" ".join(fallback_notes) or "No bundled detector model is available.",
        fallback_chain=fallback_chain,
    )


def detector_model_availability(models_root: Path) -> dict[str, Any]:
    profiles: dict[str, Any] = {}
    for profile in DETECTOR_PROFILES.values():
        pt_path = models_root / f"{profile.model_name}.pt"
        openvino_paths = _openvino_model_paths(profile.model_name, profile.image_size, models_root)
        openvino_available = [path for path in openvino_paths if path.exists()]
        profiles[profile.name] = {
            "model": profile.model_name,
            "role": profile.role,
            "required": profile.name == "emergency",
            "optional": profile.optional,
            "available": pt_path.exists() or bool(openvino_available),
            "pt": {"path": str(pt_path), "exists": pt_path.exists()},
            "openvino": [{"path": str(path), "exists": path.exists()} for path in openvino_paths],
            "available_runtimes": _available_runtimes_for_profile(profile.name, models_root),
        }
    return profiles


def resolve_model_path(
    configured_model_path: str, profile_name: str, runtime: str, models_root: Path
) -> Path | None:
    requested_path = Path(configured_model_path)
    if requested_path.is_absolute():
        if requested_path.exists():
            return requested_path
        raise FileNotFoundError(f"YOLO model file was not found at {requested_path}.")
    if configured_model_path != "yolo11n.pt":
        bundled_path = models_root / requested_path.name
        if bundled_path.exists():
            return bundled_path
        raise FileNotFoundError(f"YOLO model file was not found at {bundled_path}.")
    return _first_existing_model_path(profile_name, runtime, models_root)


def _normalize_processing_profile(processing_profile: str) -> str:
    return processing_profile if processing_profile in PROCESSING_PROFILE_VALUES else "auto"


def _auto_profile(capabilities: dict[str, Any]) -> tuple[str, str]:
    if bool(capabilities.get("cuda_available")):
        return "balanced", "CUDA is available; selected balanced YOLO11s profile."
    if bool(capabilities.get("openvino_available")):
        return "compatibility", "OpenVINO is available; selected compatibility YOLO11n profile."
    return "emergency", "No accelerator runtime detected; selected emergency CPU YOLO11n profile."


def _runtime_candidates(
    profile: DetectorProfile, requested_runtime: str, capabilities: dict[str, Any]
) -> tuple[str, ...]:
    candidates: tuple[str, ...]
    if requested_runtime == "cpu":
        candidates = ("cpu",)
    elif requested_runtime == "openvino":
        candidates = ("openvino", "cpu")
    elif requested_runtime == "cuda":
        candidates = ("cuda", "cpu")
    else:
        candidates = (*profile.preferred_runtimes, "cpu")
    return tuple(
        runtime
        for index, runtime in enumerate(candidates)
        if runtime not in candidates[:index] and _runtime_available(runtime, capabilities)
    )


def _visible_fallback_chain(
    fallback_chain: tuple[str, ...], effective_profile: str
) -> tuple[str, ...]:
    if effective_profile not in fallback_chain:
        return fallback_chain
    return fallback_chain[: fallback_chain.index(effective_profile) + 1]


def _runtime_available(runtime: str, capabilities: dict[str, Any]) -> bool:
    if runtime in {"auto", "cpu"}:
        return True
    runtime_available = capabilities.get("runtime_available")
    if isinstance(runtime_available, dict) and runtime in runtime_available:
        return bool(runtime_available[runtime])
    key = "cuda_available" if runtime == "cuda" else "openvino_available"
    return bool(capabilities.get(key)) if runtime in {"cuda", "openvino"} else False


def _first_existing_model_path(profile_name: str, runtime: str, models_root: Path) -> Path | None:
    for path in _model_path_candidates(DETECTOR_PROFILES[profile_name], runtime, models_root):
        if path.exists():
            return path
    return None


def _model_path_candidates(
    profile: DetectorProfile, runtime: str, models_root: Path
) -> tuple[Path, ...]:
    if runtime == "openvino":
        return _openvino_model_paths(profile.model_name, profile.image_size, models_root)
    return (models_root / f"{profile.model_name}.pt",)


def _openvino_model_paths(model_name: str, image_size: int, models_root: Path) -> tuple[Path, ...]:
    return (
        models_root / f"{model_name}_{image_size}_openvino_model",
        models_root / f"{model_name}_openvino_model",
    )


def _available_runtimes_for_profile(profile_name: str, models_root: Path) -> list[str]:
    profile = DETECTOR_PROFILES[profile_name]
    runtimes: list[str] = []
    if (models_root / f"{profile.model_name}.pt").exists():
        runtimes.extend(["cpu", "cuda"])
    if any(
        path.exists()
        for path in _openvino_model_paths(profile.model_name, profile.image_size, models_root)
    ):
        runtimes.append("openvino")
    return sorted(set(runtimes))


def _resolve_tracker(
    profile_name: str, requested_tracker: str, config_path: TrackerConfigResolver
) -> tuple[str, Path, str | None]:
    preferred = (
        DETECTOR_PROFILES[profile_name].default_tracker
        if requested_tracker == "auto"
        else requested_tracker
    )
    preferred_path = config_path(profile_name, preferred)
    if preferred == "botsort" and not preferred_path.exists():
        return (
            "bytetrack",
            config_path(profile_name, "bytetrack"),
            "BoT-SORT config was unavailable; using ByteTrack.",
        )
    return preferred, preferred_path, None
