"""Physical coverage determines counting contributions, independently of camera mode."""

from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CameraCoverage(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    role: Literal["unconfigured", "external_boundary", "internal_observation"] = "unconfigured"
    area_name: str = Field(default="", max_length=120)
    relationship: Literal["unknown", "independent", "contained", "overlapping", "alternative"] = (
        "unknown"
    )
    related_camera_id: int | None = Field(default=None, ge=1)
    # Minimum plausible travel time from this camera to another camera.
    travel_seconds: dict[int, float] = Field(default_factory=dict, max_length=16)

    @model_validator(mode="after")
    def validate_relationship(self) -> Self:
        self.area_name = self.area_name.strip()
        linked = self.relationship in {"contained", "overlapping", "alternative"}
        if linked != (self.related_camera_id is not None):
            raise ValueError(
                "Select a related camera for contained, overlapping, or alternative coverage."
            )
        if any(key <= 0 or not 0 <= value <= 3600 for key, value in self.travel_seconds.items()):
            raise ValueError("Travel times require positive camera IDs and 0–3600 seconds.")
        return self


def validate_camera_coverages(profiles: list[dict[str, Any]]) -> None:
    """Validate the full graph before writing any profiles."""
    coverage = {
        int(profile["id"]): CameraCoverage.model_validate(profile.get("coverage") or {})
        for profile in profiles
    }
    for camera_id, config in coverage.items():
        targets = set(config.travel_seconds)
        if config.related_camera_id is not None:
            targets.add(config.related_camera_id)
        if camera_id in targets or not targets.issubset(coverage):
            raise ValueError("Coverage must reference another configured camera.")
        if config.relationship in {"contained", "overlapping", "alternative"}:
            target = config.related_camera_id
            assert target is not None
            if (
                config.travel_seconds.get(target, 0) > 0
                or coverage[target].travel_seconds.get(camera_id, 0) > 0
            ):
                raise ValueError(
                    "Shared camera views cannot also require travel between separate areas."
                )
        path: set[int] = {camera_id}
        current = config
        while current.relationship in {"contained", "alternative"}:
            target = current.related_camera_id
            if target is None:
                break
            if target in path:
                raise ValueError(
                    "Camera containment and fallback relationships cannot form a cycle."
                )
            path.add(target)
            current = coverage[target]


def camera_pair_relation(
    first_id: int, first: CameraCoverage, second_id: int, second: CameraCoverage
) -> tuple[str, float | None]:
    """Return overlap/separate/unknown and the configured minimum travel time."""
    for config, target in ((first, second_id), (second, first_id)):
        if config.related_camera_id == target and config.relationship in {
            "contained",
            "overlapping",
            "alternative",
        }:
            return "overlap", 0.0
    travel = first.travel_seconds.get(second_id)
    reverse = second.travel_seconds.get(first_id)
    if travel is not None or reverse is not None:
        return "separate", max(value for value in (travel, reverse) if value is not None)
    if first.relationship == "independent" and second.relationship == "independent":
        return "separate", None
    return "unknown", None


def camera_relation_in_graph(
    first_id: int, second_id: int, coverage: dict[int, CameraCoverage]
) -> tuple[str, float | None]:
    if first_id == second_id:
        return "overlap", 0.0
    direct = camera_pair_relation(first_id, coverage[first_id], second_id, coverage[second_id])
    if direct[0] != "unknown":
        return direct

    def ancestors(source: int) -> list[tuple[int, bool]]:
        result = []
        contained = False
        seen = set()
        while source in coverage and source not in seen:
            seen.add(source)
            result.append((source, contained))
            item = coverage[source]
            if (
                item.relationship not in {"contained", "alternative"}
                or item.related_camera_id is None
            ):
                break
            contained |= item.relationship == "contained"
            source = item.related_camera_id
        return result

    for first, first_contained in ancestors(first_id):
        for second, second_contained in ancestors(second_id):
            if first == second and not (first_contained and second_contained):
                return "overlap", 0.0
            if (
                first != second
                and camera_pair_relation(first, coverage[first], second, coverage[second])[0]
                == "separate"
            ):
                # A subset of a separate area is also separate. Camera-specific
                # travel times are not inherited from another camera position.
                return "separate", None
    return "unknown", None
