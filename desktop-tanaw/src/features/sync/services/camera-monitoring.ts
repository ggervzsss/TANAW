import type { Camera } from "../../../types/enterprise";
import type { MlCameraLiveState, MlCameraStates, MlServiceStatus } from "../../camera/services/ml-service";

export const CAMERA_FRAME_STALE_AFTER_MS = 5_000;

export type CameraMonitoringStatus = "not_configured" | "stopped" | "partial" | "running" | "error";
export type CameraRuntimeStatus = "stopped" | "starting" | "running" | "error";

export type CameraMonitoringItem = {
  cameraId: number;
  cameraName: string;
  status: CameraRuntimeStatus;
  running: boolean;
  error: string | null;
};

export type CameraMonitoringSummary = {
  status: CameraMonitoringStatus;
  configuredCameraCount: number;
  activeCameraCount: number;
  healthyCameraCount: number;
  startingCameraCount: number;
  stoppedCameraCount: number;
  errorCameraCount: number;
  cameras: CameraMonitoringItem[];
};

export function buildCameraMonitoringSummary(
  cameras: Camera[] | null,
  cameraStates: MlCameraStates | null,
  serviceStatus: MlServiceStatus,
): CameraMonitoringSummary {
  const configuredCameras = cameras ?? [];
  const runtimeByCameraId = new Map(cameraStates?.cameras.map((state) => [state.camera_id, state]) ?? []);
  const pendingCameraIds = new Set(cameraStates?.pending_camera_ids ?? []);

  const monitoredCameras = configuredCameras.map((camera) =>
    summarizeCamera(camera, runtimeByCameraId.get(camera.id), pendingCameraIds.has(camera.id), serviceStatus),
  );
  const healthyCameraCount = countStatus(monitoredCameras, "running");
  const startingCameraCount = countStatus(monitoredCameras, "starting");
  const stoppedCameraCount = countStatus(monitoredCameras, "stopped");
  const errorCameraCount = countStatus(monitoredCameras, "error");

  return {
    status: aggregateStatus({
      configuredCameraCount: monitoredCameras.length,
      healthyCameraCount,
      startingCameraCount,
      errorCameraCount,
    }),
    configuredCameraCount: monitoredCameras.length,
    activeCameraCount: healthyCameraCount + startingCameraCount,
    healthyCameraCount,
    startingCameraCount,
    stoppedCameraCount,
    errorCameraCount,
    cameras: monitoredCameras,
  };
}

function summarizeCamera(
  camera: Camera,
  runtime: MlCameraLiveState | undefined,
  pending: boolean,
  serviceStatus: MlServiceStatus,
): CameraMonitoringItem {
  const error = runtime?.counts.error ?? runtime?.session.error ?? runtime?.health.error ?? null;
  const runtimeStatus = runtime?.counts.status.toLowerCase() ?? camera.status;
  const hasExplicitError =
    Boolean(error) ||
    serviceStatus.error !== null ||
    runtimeStatus === "error" ||
    runtimeStatus === "failed" ||
    (!runtime && (camera.status === "error" || camera.status === "failed"));

  if (hasExplicitError) {
    return cameraSummary(camera, "error", false, error ?? serviceStatus.error ?? "Camera processing failed.");
  }

  if (pending || isStartingStatus(runtimeStatus)) {
    return cameraSummary(camera, "starting", false, null);
  }

  const processingFreshFrames =
    runtime?.counts.running === true &&
    runtime.session.running === true &&
    runtime.health.running === true &&
    runtime.health.model_ready === true &&
    runtime.health.processed_frame_stale_ms !== null &&
    runtime.health.processed_frame_stale_ms <= CAMERA_FRAME_STALE_AFTER_MS;

  if (processingFreshFrames) {
    return cameraSummary(camera, "running", true, null);
  }

  const runtimeClaimsRunning =
    runtime?.counts.running === true || runtime?.session.running === true || runtime?.health.running === true;
  if (runtimeClaimsRunning) {
    return cameraSummary(camera, "starting", false, null);
  }

  return cameraSummary(camera, "stopped", false, null);
}

function cameraSummary(
  camera: Camera,
  status: CameraRuntimeStatus,
  running: boolean,
  error: string | null,
): CameraMonitoringItem {
  return {
    cameraId: camera.id,
    cameraName: camera.name,
    status,
    running,
    error,
  };
}

function isStartingStatus(status: string) {
  return status === "starting" || status === "connecting" || status === "reconnecting";
}

function countStatus(cameras: CameraMonitoringItem[], status: CameraRuntimeStatus) {
  return cameras.filter((camera) => camera.status === status).length;
}

function aggregateStatus({
  configuredCameraCount,
  healthyCameraCount,
  startingCameraCount,
  errorCameraCount,
}: {
  configuredCameraCount: number;
  healthyCameraCount: number;
  startingCameraCount: number;
  errorCameraCount: number;
}): CameraMonitoringStatus {
  if (configuredCameraCount === 0) return "not_configured";
  if (errorCameraCount > 0) return "error";
  if (healthyCameraCount === configuredCameraCount) return "running";
  if (healthyCameraCount > 0 || startingCameraCount > 0) return "partial";
  return "stopped";
}
