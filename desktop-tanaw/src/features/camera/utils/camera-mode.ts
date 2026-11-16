import type { AnalysisMode } from "../../../types/enterprise";

/** The one name and description of each camera mode, used on every screen. */
export const CAMERA_MODE_LABEL = "Camera Mode";

export const CAMERA_MODE_OPTIONS: Array<readonly [AnalysisMode, string]> = [
  ["entrance_exit", "Entry / Exit"],
  ["open_space", "Open Space"],
];

export function cameraModeName(mode: AnalysisMode | undefined) {
  return mode === "open_space" ? "Open Space" : "Entry / Exit";
}

export function cameraModeDescription(mode: AnalysisMode | undefined) {
  return mode === "open_space" ? "Counts people currently inside the marked area." : "Counts people crossing the line into or out of the establishment.";
}

/** Male/female estimates need to see people's bodies, not only the tops of their heads. */
export const CAMERA_PLACEMENT_NOTE = "For male and female estimates, angle the camera toward people rather than straight down.";
