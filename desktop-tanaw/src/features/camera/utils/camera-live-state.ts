import type { CameraStatus } from "../../../types/enterprise";
import type { MlCameraLiveState, MlCameraStates } from "../services/ml-service";

export function mergeCameraStates(
  current: Record<number, MlCameraLiveState>,
  payload: MlCameraStates,
  allowedCameraIds: ReadonlySet<number>,
) {
  const next = { ...current };
  for (const cameraId of Object.keys(next).map(Number)) {
    if (!allowedCameraIds.has(cameraId)) delete next[cameraId];
  }
  for (const state of payload.cameras) {
    if (allowedCameraIds.has(state.camera_id)) next[state.camera_id] = state;
  }
  return next;
}

export function cameraStatusFromRuntime(state: MlCameraLiveState): CameraStatus {
  if (state.counts.status === "failed") return "failed";
  if (state.counts.status === "error") return "error";
  if (!state.counts.running) return "stopped";
  if (state.counts.status === "starting" || state.counts.status === "connecting" || state.counts.status === "degraded" || state.counts.status === "reconnecting") return state.counts.status;
  return "running";
}
