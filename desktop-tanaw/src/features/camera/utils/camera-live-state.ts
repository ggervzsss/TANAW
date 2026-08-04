import type { CameraStatus } from "../../../types/enterprise";
import type { MlCameraLiveState, MlCameraStates } from "../services/ml-service";

export function mergeCameraStates(current: Record<number, MlCameraLiveState>, payload: MlCameraStates, allowedCameraIds: ReadonlySet<number>) {
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

export function isAcceptedCameraStartSettled(payload: MlCameraStates, cameraId: number) {
  if (payload.pending_camera_ids.includes(cameraId)) return false;
  const state = payload.cameras.find((camera) => camera.camera_id === cameraId);
  if (!state) return false;
  return isCameraPreviewReady(state) || state.counts.status === "failed" || state.counts.status === "error";
}

export function isCameraPreviewReady(state: MlCameraLiveState | undefined) {
  if (!state?.counts.running) return false;
  return state.counts.status === "running" || state.counts.status === "degraded";
}

export function isCameraStartOutcomeUncertain(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return isRequestTimeoutMessage(message);
}

export function isTransientCameraStartupPollError(error: unknown, cameraStartIsPending: boolean) {
  return cameraStartIsPending && isCameraStartOutcomeUncertain(error);
}

export function clearRecoveredCameraRequestErrors(current: Record<number, string | null>, states: readonly MlCameraLiveState[]) {
  let next = current;
  for (const state of states) {
    const currentError = next[state.camera_id];
    if (!currentError || !isRequestTimeoutMessage(currentError) || !state.counts.running || state.counts.error || state.counts.status === "error" || state.counts.status === "failed") {
      continue;
    }
    if (next === current) next = { ...current };
    delete next[state.camera_id];
  }
  return next;
}

function isRequestTimeoutMessage(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes("timeout") || normalized.includes("timed out") || normalized.includes("did not respond in time") || normalized.includes("aborted due to timeout");
}
