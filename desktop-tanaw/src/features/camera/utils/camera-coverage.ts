import type { CameraCoverage } from "../../../types/enterprise";

export const EMPTY_CAMERA_COVERAGE: CameraCoverage = {
  role: "unconfigured",
  area_name: "",
  relationship: "unknown",
  related_camera_id: null,
  travel_seconds: {},
};

export function validateCameraCoverage(coverage: CameraCoverage | undefined, cameraId: number): string | null {
  if (!coverage) return null;
  const requiresCamera = ["contained", "overlapping", "alternative"].includes(coverage.relationship);
  if (requiresCamera && !coverage.related_camera_id) return "Select the camera whose area this view shares.";
  if (!requiresCamera && coverage.related_camera_id !== null) return "A separate area cannot reference a shared camera.";
  if (coverage.related_camera_id === cameraId) return "Select another camera for shared coverage.";
  for (const [target, seconds] of Object.entries(coverage.travel_seconds)) {
    if (!Number.isInteger(Number(target)) || Number(target) <= 0 || Number(target) === cameraId || !Number.isFinite(seconds) || seconds < 0 || seconds > 3600) {
      return "Travel times must reference another camera and be between 0 and 3600 seconds.";
    }
  }
  return null;
}
