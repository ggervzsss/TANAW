import type { Camera } from "../../../types/enterprise";

export function createCameraUpdateGate() {
  const activeCameraIds = new Set<number>();
  return {
    begin(cameraId: number) {
      if (activeCameraIds.has(cameraId)) return false;
      activeCameraIds.add(cameraId);
      return true;
    },
    end(cameraId: number) {
      activeCameraIds.delete(cameraId);
    },
    isActive(cameraId: number) {
      return activeCameraIds.has(cameraId);
    },
  };
}

export function hasCameraConnectionChange(
  previous: Camera,
  next: Camera,
  passwordChanged = false,
) {
  return (
    previous.rtsp !== next.rtsp ||
    previous.cameraHost !== next.cameraHost ||
    previous.rtspStream !== next.rtspStream ||
    previous.username !== next.username ||
    passwordChanged
  );
}

export function hasCameraRuntimeChange(
  previous: Camera,
  next: Camera,
  passwordChanged = false,
) {
  return (
    hasCameraRestartRequiredChange(previous, next, passwordChanged) ||
    hasCameraCountingConfigChange(previous, next)
  );
}

export function hasCameraCountingConfigChange(previous: Camera, next: Camera) {
  return JSON.stringify(previous.config) !== JSON.stringify(next.config);
}

export function hasCameraRestartRequiredChange(
  previous: Camera,
  next: Camera,
  passwordChanged = false,
) {
  if (hasCameraConnectionChange(previous, next, passwordChanged)) return true;

  return (
    previous.processingProfile !== next.processingProfile ||
    previous.confidence !== next.confidence ||
    previous.trackingConfidence !== next.trackingConfidence ||
    previous.reidMode !== next.reidMode ||
    previous.uniqueCountingMode !== next.uniqueCountingMode
  );
}

export function shouldRestartCameraAfterSave(
  previous: Camera,
  next: Camera,
  options: { isRunning: boolean; passwordChanged?: boolean },
) {
  return (
    options.isRunning &&
    hasCameraRestartRequiredChange(previous, next, options.passwordChanged)
  );
}

export type CameraSaveRuntimeAction =
  | "none"
  | "hot-update-counting"
  | "restart";

export function getCameraSaveRuntimeAction(
  previous: Camera,
  next: Camera,
  options: { isRunning: boolean; passwordChanged?: boolean },
): CameraSaveRuntimeAction {
  if (!options.isRunning) return "none";
  if (
    hasCameraRestartRequiredChange(
      previous,
      next,
      options.passwordChanged,
    )
  ) {
    return "restart";
  }
  if (hasCameraCountingConfigChange(previous, next)) {
    return "hot-update-counting";
  }
  return "none";
}

export function mergeConfirmedCameraCountingConfig(
  current: Camera,
  confirmed: Camera["config"],
): Camera {
  return {
    ...current,
    config: structuredClone(confirmed),
  };
}
