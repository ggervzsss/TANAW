import type { Camera, CameraStatus } from "../../../types/enterprise";
import { validateRtspUrl } from "../../../utils/form-validation";
import { buildTapoRtspUrl, isValidIpv4, maskStreamCredentials, parseRtspConnection, stripStreamCredentials } from "../utils/rtsp";
import { createTripwireLine, normalizeTripwireLine } from "../utils/tripwire-path";
import type { CameraCredentialMetadataRecords } from "../services/camera-credentials";
import { MlServiceRequestError } from "../services/ml-service";

export type CameraAction = "requesting-start" | "saving" | "starting" | "stopping" | "testing";
export const DEFAULT_COUNTING_CONFIDENCE = 0.35;
export const DEFAULT_TRACKING_CONFIDENCE = 0.15;
export const DEFAULT_ROI: Camera["config"]["roi"] = { top: 0, left: 0, width: 100, height: 100 };
const PREVIOUS_DEFAULT_ROI: Camera["config"]["roi"] = { top: 10, left: 10, width: 80, height: 80 };

export function isRuntimeStatus(status: CameraStatus) {
  return status === "starting" || status === "connecting" || status === "running" || status === "degraded" || status === "reconnecting";
}

export function isStartAction(action: CameraAction | undefined) {
  return action === "requesting-start" || action === "starting";
}

export function validateCamera(camera: Camera, hasStoredPassword: boolean) {
  if (!isValidIpv4(camera.cameraHost ?? "")) return "Camera IP must be a valid IPv4 address.";
  if (!camera.username?.trim()) return "Enter the camera username.";
  if (!hasStoredPassword) return "Enter the camera password.";
  const streamError = validateRtspUrl(camera.rtsp);
  if (streamError) return streamError;
  if (!Number.isFinite(camera.confidence) || camera.confidence < 0.05 || camera.confidence > 0.95) return "Counting confidence must be between 0.05 and 0.95.";
  if (!Number.isFinite(camera.trackingConfidence ?? 0.15) || (camera.trackingConfidence ?? 0.15) < 0.01 || (camera.trackingConfidence ?? 0.15) > camera.confidence)
    return "Tracking confidence must be between 0.01 and the counting confidence.";
  return null;
}

export function updateCamerasWhenChanged(cameras: Camera[], updateCamera: (camera: Camera) => Camera) {
  let changed = false;
  const updated = cameras.map((camera) => {
    const nextCamera = updateCamera(camera);
    if (nextCamera !== camera) changed = true;
    return nextCamera;
  });
  return changed ? updated : cameras;
}

export function normalizeCamera(camera: Camera): Camera {
  const streamUrl = camera.rtsp ?? "";
  const parsedRtsp = parseRtspConnection(streamUrl);
  const cameraHost = camera.cameraHost ?? parsedRtsp.host;
  const rtspStream = camera.rtspStream ?? parsedRtsp.streamId;
  const normalizedStreamUrl = buildTapoRtspUrl(cameraHost, rtspStream) || stripStreamCredentials(streamUrl);
  const tripwire = camera.config?.tripwire ?? 50;
  const confidence = camera.confidence ?? DEFAULT_COUNTING_CONFIDENCE;
  const rawTrackingConfidence = camera.trackingConfidence ?? DEFAULT_TRACKING_CONFIDENCE;
  return {
    ...camera,
    cameraHost: cameraHost || undefined,
    confidence,
    reidMode: normalizeReIdMode(camera.reidMode),
    trackingConfidence: Math.max(0.01, Math.min(rawTrackingConfidence, confidence)),
    uniqueCountingMode: normalizeUniqueCountingMode(camera.uniqueCountingMode),
    password: undefined,
    processingProfile: normalizeProcessingProfile(camera.processingProfile),
    rtsp: maskStreamCredentials(normalizedStreamUrl),
    rtspStream,
    status: camera.status && isRuntimeStatus(camera.status) ? "stopped" : (camera.status ?? "untested"),
    username: normalizeOptionalCredential(camera.username),
    config: {
      ...camera.config,
      tripwire,
      tripwires: camera.config?.tripwires ? { entry: normalizeTripwireLine(camera.config.tripwires.entry), exit: normalizeTripwireLine(camera.config.tripwires.exit) } : getDefaultTripwires(tripwire),
      roi: normalizeRoi(camera.config?.roi),
      reverse: camera.config?.reverse ?? false,
    },
  };
}

function normalizeRoi(roi: Camera["config"]["roi"] | undefined): Camera["config"]["roi"] {
  if (!roi || sameRoi(roi, PREVIOUS_DEFAULT_ROI)) return DEFAULT_ROI;
  const normalized = { top: clampPercent(roi.top), left: clampPercent(roi.left), width: clampPercent(roi.width), height: clampPercent(roi.height) };
  if (normalized.left + normalized.width > 100) normalized.width = Math.max(0, 100 - normalized.left);
  if (normalized.top + normalized.height > 100) normalized.height = Math.max(0, 100 - normalized.top);
  return normalized;
}

function sameRoi(left: Camera["config"]["roi"], right: Camera["config"]["roi"]) {
  return left.top === right.top && left.left === right.left && left.width === right.width && left.height === right.height;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function normalizeReIdMode(mode: unknown): Camera["reidMode"] {
  return mode === "auto" || mode === "off" || mode === "fast" || mode === "quality" ? mode : "auto";
}

function normalizeUniqueCountingMode(mode: unknown): Camera["uniqueCountingMode"] {
  return mode === "entry_only" || mode === "estimated_reid" ? mode : "estimated_reid";
}

export function redactCameraForStorage(camera: Camera): Camera {
  return {
    ...camera,
    password: undefined,
    rtsp: stripStreamCredentials(camera.rtsp),
    // Runtime state is reported separately by the ML service. Keeping it out of
    // the stored profile prevents status polling from looking like a camera
    // configuration edit and issuing a write during model warm-up.
    status: "stopped",
    username: undefined,
  };
}

export function getCameraStorageFingerprint(cameras: Camera[]) {
  return JSON.stringify(cameras.map(redactCameraForStorage));
}

export function applyStoredCameraMetadata(camera: Camera, credentials: CameraCredentialMetadataRecords): Camera {
  const record = credentials[String(camera.id)];
  if (!record) return camera;
  return {
    ...camera,
    password: undefined,
    username: normalizeOptionalCredential(record.username) ?? camera.username,
  };
}

function normalizeOptionalCredential(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeProcessingProfile(profile: unknown): Camera["processingProfile"] {
  return profile === "auto" || profile === "compatibility" || profile === "balanced" || profile === "high_accuracy" || profile === "emergency" ? profile : "auto";
}

export function getDefaultTripwires(centerX: number) {
  return {
    entry: createTripwireLine([
      { x: Math.max(5, centerX - 8), y: 12 },
      { x: Math.max(5, centerX - 8), y: 88 },
    ]),
    exit: createTripwireLine([
      { x: Math.min(95, centerX + 8), y: 12 },
      { x: Math.min(95, centerX + 8), y: 88 },
    ]),
  };
}

export function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "The ML camera service request failed.";
}

export function getTripwireSaveErrorMessage(error: unknown) {
  if (!(error instanceof MlServiceRequestError)) {
    return "Unable to save Tripwire configuration. The live camera stream was not interrupted.";
  }

  if (error.status === 422 || error.code === "invalid_camera_configuration") {
    return "The Tripwire paths are invalid. Adjust the Entry and Exit geometry and try again.";
  }

  const messages: Partial<Record<typeof error.code, string>> = {
    camera_not_active: "The camera is no longer processing. Its existing Tripwire configuration was not changed.",
    camera_not_found: "The selected camera configuration no longer exists. Refresh Camera Setup and try again.",
    request_timeout: "The camera worker did not acknowledge the Tripwire update in time. The live stream remains active.",
    route_unavailable: "Live Tripwire updates are unavailable because the local ML service is outdated.",
    service_unavailable: "The local ML service is unavailable. The existing Tripwire configuration remains active.",
    tripwire_persistence_failed: "Unable to persist the Tripwire configuration. The active geometry was not changed.",
    tripwire_worker_update_failed: "The active camera worker rejected the Tripwire update. The previous geometry remains active.",
  };
  return messages[error.code] ?? "Unable to save Tripwire configuration. The live camera stream was not interrupted.";
}
