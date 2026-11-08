import type { MlCameraStates } from "../features/camera/services/ml-service.types";

export const ML_REPORT_LIVE_EVENT_CHANNELS = {
  event: "ml-service:report-events:event",
  subscribe: "ml-service:report-events:subscribe",
  unsubscribe: "ml-service:report-events:unsubscribe",
} as const;

export const MAX_ML_REPORT_LIVE_EVENT_BYTES = 2_000_000;

export type MlReportLiveEvent =
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "service.error"; code: "local_database_reset_required"; message: string; retryable: false }
  | { type: "camera.states"; data: MlCameraStates };

export function parseMlReportLiveEvent(rawData: string): MlReportLiveEvent | null {
  if (new TextEncoder().encode(rawData).byteLength > MAX_ML_REPORT_LIVE_EVENT_BYTES) {
    return null;
  }

  let value: unknown;
  try {
    value = JSON.parse(rawData);
  } catch {
    return null;
  }

  if (!isRecord(value)) return null;
  if (value.type === "service.error" && value.code === "local_database_reset_required" && typeof value.message === "string" && value.retryable === false) {
    return { type: "service.error", code: value.code, message: value.message, retryable: false };
  }
  if (value.type !== "camera.states" || !isCameraStates(value.data)) {
    return null;
  }

  return { type: "camera.states", data: value.data as MlCameraStates };
}

function isCameraStates(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.enterprise_id === "string" &&
    isFiniteNumber(value.enterprise_occupancy) &&
    isFiniteNumber(value.active_camera_count) &&
    isFiniteNumber(value.max_configured_cameras) &&
    isFiniteNumber(value.max_concurrent_cameras) &&
    Array.isArray(value.pending_camera_ids) &&
    value.pending_camera_ids.every(isInteger) &&
    Array.isArray(value.cameras) &&
    value.cameras.every(isCameraState)
  );
}

function isCameraState(value: unknown) {
  return isRecord(value) && isInteger(value.camera_id) && isCounts(value.counts, value.analysis_mode === "open_space") && isDetections(value.detections) && isSession(value.session) && isHealth(value.health);
}

function isCounts(value: unknown, openSpace: boolean) {
  return (
    isRecord(value) &&
    (openSpace ? value.entry === null && value.exit === null && value.occupancy === null : isFiniteNumber(value.entry) && isFiniteNumber(value.exit) && isFiniteNumber(value.occupancy)) &&
    typeof value.running === "boolean" &&
    typeof value.status === "string" &&
    isNullableString(value.error)
  );
}

function isDetections(value: unknown) {
  return isRecord(value) && isNullableFiniteNumber(value.frame_width) && isNullableFiniteNumber(value.frame_height) && Array.isArray(value.tracks) && value.tracks.every((track: unknown) =>
    isRecord(track) && isInteger(track.track_id) && isInteger(track.source_track_id) && isFiniteNumber(track.confidence) && Array.isArray(track.bbox) && track.bbox.length === 4 && track.bbox.every(isFiniteNumber) && Array.isArray(track.centroid) && track.centroid.length === 2 && track.centroid.every(isFiniteNumber));
}

function isSession(value: unknown) {
  return isRecord(value) && typeof value.running === "boolean" && typeof value.status === "string" && isNullableString(value.error);
}

function isHealth(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.running === "boolean" &&
    typeof value.model_ready === "boolean" &&
    isNullableFiniteNumber(value.processed_frame_stale_ms) &&
    isFiniteNumber(value.estimated_unique_count) &&
    isFiniteNumber(value.confirmed_unique_count) &&
    isFiniteNumber(value.degraded_unique_count)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value);
}

function isFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown) {
  return value === null || isFiniteNumber(value);
}

function isNullableString(value: unknown) {
  return value === null || typeof value === "string";
}
