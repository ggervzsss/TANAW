import type { Camera } from "../../../types/enterprise";
import { getMemoryCameraCredential } from "./camera-credentials";
import { getTripwireAnchors, getTripwireSampledPoints, normalizeTripwireLine } from "../utils/tripwire-path";
import { assertUniqueCameraIps, canonicalizeCameraIp } from "../utils/camera-ip-uniqueness";
import {
  MlServiceRequestError,
  type CameraTestResult,
  type LocalMetricsHistory,
  type LocalMetricsSummary,
  type LocalReportDraft,
  type LocalReportSubmission,
  type LocalReportSubmissionRecord,
  type MlCameraStates,
  type MlCounts,
  type MlDetections,
  type MlEnterpriseContext,
  type MlHealth,
  type MlServiceErrorCode,
  type MlServiceStatus,
  type MlSession,
  type SamplePreparationRequest,
} from "./ml-service.types";

export * from "./ml-service.types";

export const DEFAULT_ML_SERVICE_BASE_URL = import.meta.env.VITE_ML_SERVICE_URL ?? "http://127.0.0.1:8765";

export const EMPTY_ML_COUNTS: MlCounts = {
  entry: 0,
  exit: 0,
  occupancy: 0,
  running: false,
  status: "stopped",
  started_at: null,
  error: null,
};

export const EMPTY_ML_DETECTIONS: MlDetections = {
  running: false,
  status: "stopped",
  error: null,
  frame_width: null,
  frame_height: null,
  tracks: [],
};

export async function getMlServiceStatus(): Promise<MlServiceStatus> {
  if (window.tanawMlService) {
    try {
      const status = await window.tanawMlService.getStatus();
      return status;
    } catch {
      return {
        baseUrl: DEFAULT_ML_SERVICE_BASE_URL,
        desktopBuild: "development",
        desktopVersion: "web",
        error: "Electron ML service bridge is unavailable.",
        packaged: false,
        pid: null,
        running: false,
      };
    }
  }

  return { baseUrl: DEFAULT_ML_SERVICE_BASE_URL, desktopBuild: "development", desktopVersion: "web", error: null, packaged: false, pid: null, running: false };
}

export async function restartMlService(): Promise<MlServiceStatus> {
  if (!window.tanawMlService) {
    return {
      baseUrl: DEFAULT_ML_SERVICE_BASE_URL,
      desktopBuild: "development",
      desktopVersion: "web",
      error: "Restart is only available inside Electron.",
      packaged: false,
      pid: null,
      running: false,
    };
  }

  const status = await window.tanawMlService.restart();
  return status;
}

export async function getMlHealth(baseUrl: string): Promise<MlHealth> {
  return requestJson<MlHealth>(`${baseUrl}/health`, { method: "GET" }, 2500);
}

export async function getMlSession(baseUrl: string): Promise<MlSession> {
  return requestJson<MlSession>(`${baseUrl}/session`, { method: "GET" }, 2500);
}

export async function getMlCameraStates(baseUrl: string): Promise<MlCameraStates> {
  return requestJson<MlCameraStates>(`${baseUrl}/cameras/runtime`, { method: "GET" }, 2500);
}

export async function setMlEnterpriseContext(baseUrl: string, enterpriseId: string, enterpriseName?: string | null): Promise<MlEnterpriseContext> {
  return requestJson<MlEnterpriseContext>(
    `${baseUrl}/context/enterprise`,
    {
      method: "POST",
      body: JSON.stringify({
        enterprise_id: enterpriseId,
        enterprise_name: enterpriseName || null,
      }),
    },
    10_000,
  );
}

export async function listLocalCameras(baseUrl: string): Promise<Camera[]> {
  return requestJson<Camera[]>(`${baseUrl}/cameras`, { method: "GET" }, 2500);
}

const cameraWriteQueues = new Map<string, Promise<unknown>>();

export async function replaceLocalCameras(baseUrl: string, cameras: Camera[]): Promise<Camera[]> {
  const canonicalCameras = cameras.map(canonicalizeCameraIp);
  assertUniqueCameraIps(canonicalCameras);

  const previousWrite = cameraWriteQueues.get(baseUrl) ?? Promise.resolve();
  const write = previousWrite
    .catch(() => undefined)
    .then(() =>
      requestJson<Camera[]>(
        `${baseUrl}/cameras`,
        {
          method: "PUT",
          body: JSON.stringify({ cameras: canonicalCameras }),
        },
        5000,
      ),
    );
  cameraWriteQueues.set(baseUrl, write);
  try {
    return await write;
  } finally {
    if (cameraWriteQueues.get(baseUrl) === write) cameraWriteQueues.delete(baseUrl);
  }
}

export async function getLocalMetricsSummary(baseUrl: string, options: { includeSubmitted?: boolean } = {}): Promise<LocalMetricsSummary> {
  return requestJson<LocalMetricsSummary>(`${baseUrl}/metrics/summary${queryFromOptions(options)}`, { method: "GET" }, 2500);
}

export async function getLocalMetricsHistory(baseUrl: string, options: { includeSubmitted?: boolean } = {}): Promise<LocalMetricsHistory> {
  return requestJson<LocalMetricsHistory>(`${baseUrl}/metrics/history${queryFromOptions(options)}`, { method: "GET" }, 2500);
}

export async function recordLocalReportSubmission(
  baseUrl: string,
  payload: {
    metrics: { entries: number; exits: number; peakOccupancy: number; uniqueCount: number };
    notes: string;
    period: string;
    reportId: string;
    reportPayload: Record<string, unknown>;
  },
): Promise<LocalReportSubmission> {
  return requestJson<LocalReportSubmission>(
    `${baseUrl}/reports/local-submit`,
    {
      method: "POST",
      body: JSON.stringify({
        metrics: {
          entries: payload.metrics.entries,
          exits: payload.metrics.exits,
          peak_occupancy: payload.metrics.peakOccupancy,
          unique_count: payload.metrics.uniqueCount,
        },
        notes: payload.notes || null,
        payload: payload.reportPayload,
        period: payload.period,
        report_id: payload.reportId,
      }),
    },
    5000,
  );
}

export async function listLocalReportSubmissions(baseUrl: string, limit = 100): Promise<LocalReportSubmissionRecord[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  return requestJson<LocalReportSubmissionRecord[]>(`${baseUrl}/reports/local?${params.toString()}`, { method: "GET" }, 2500);
}

export async function getLocalReportDraft(baseUrl: string, draftKey: string): Promise<LocalReportDraft | null> {
  return requestJson<LocalReportDraft | null>(`${baseUrl}/reports/drafts/${encodeURIComponent(draftKey)}`, { method: "GET" }, 2500);
}

export async function saveLocalReportDraft(baseUrl: string, draftKey: string, payload: { period: string; reportId: string | null; reportPayload: Record<string, unknown> }): Promise<LocalReportDraft> {
  return requestJson<LocalReportDraft>(
    `${baseUrl}/reports/drafts/${encodeURIComponent(draftKey)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        period: payload.period,
        report_id: payload.reportId,
        payload: payload.reportPayload,
      }),
    },
    2500,
  );
}

export async function deleteLocalReportDraft(baseUrl: string, draftKey: string): Promise<{ updated: number }> {
  return requestJson<{ updated: number }>(`${baseUrl}/reports/drafts/${encodeURIComponent(draftKey)}`, { method: "DELETE" }, 2500);
}

export async function markLocalReportSynced(baseUrl: string, reportId: string): Promise<{ updated: number }> {
  return requestJson<{ updated: number }>(`${baseUrl}/reports/local/${encodeURIComponent(reportId)}/synced`, { method: "POST" }, 2500);
}

export async function purgeLocalReportRawEvents(baseUrl: string, reportId: string): Promise<{ report_id: string; purged_events: number; raw_purged_at: string | null }> {
  return requestJson<{ report_id: string; purged_events: number; raw_purged_at: string | null }>(`${baseUrl}/reports/local/${encodeURIComponent(reportId)}/purge-raw`, { method: "POST" }, 5000);
}

export async function markLocalEventsSynced(baseUrl: string): Promise<{ updated: number }> {
  return requestJson<{ updated: number }>(`${baseUrl}/metrics/mark-synced`, { method: "POST" }, 2500);
}

export async function prepareLocalSampleCounts(baseUrl: string, payload: SamplePreparationRequest): Promise<LocalMetricsSummary & { prepared: boolean }> {
  return requestJson<LocalMetricsSummary & { prepared: boolean }>(
    `${baseUrl}/sample/prepare`,
    {
      method: "POST",
      body: JSON.stringify({
        enterprise_id: payload.enterpriseId,
        enterprise_name: payload.enterpriseName,
        entries: payload.entries,
        exits: payload.exits,
        unique_count: payload.uniqueCount,
        peak_occupancy: payload.peakOccupancy,
        period: payload.period,
        report_id: payload.reportId,
      }),
    },
    15_000,
  );
}

export async function testCameraConnection(baseUrl: string, camera: Camera, credentialScope?: string): Promise<CameraTestResult> {
  const credential = credentialScope ? getMemoryCameraCredential(credentialScope, camera.id) : undefined;
  const payload = {
    camera_id: camera.id,
    camera_name: camera.name,
    camera_host: camera.cameraHost || null,
    rtsp_stream: camera.rtspStream || null,
    stream_url: camera.rtsp,
  };
  if (credentialScope && window.tanawCameraCredentials) {
    return window.tanawCameraCredentials.request(camera.id, "test", payload) as Promise<CameraTestResult>;
  }
  return requestJson<CameraTestResult>(
    `${baseUrl}/camera/test`,
    {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        password: credential?.password ?? camera.password ?? null,
        username: credential?.username ?? camera.username ?? null,
      }),
    },
    8000,
  );
}

export async function startCameraProcessing(baseUrl: string, camera: Camera, credentialScope?: string): Promise<{ message: string }> {
  const credential = credentialScope ? getMemoryCameraCredential(credentialScope, camera.id) : undefined;
  const payload = {
    camera_name: camera.name,
    camera_zone: camera.zone,
    camera_id: camera.id,
    camera_host: camera.cameraHost || null,
    confidence: camera.confidence,
    counting_confidence: camera.confidence,
    entry_line: toMlTripwireLine(camera.config.tripwires.entry),
    event_cooldown_seconds: 3.6,
    exit_line: toMlTripwireLine(camera.config.tripwires.exit),
    paired_line_max_gap_seconds: 18,
    processing_profile: camera.processingProfile,
    runtime_backend: "auto",
    tracker_profile: "auto",
    pending_reid_wait_seconds: 0.6,
    reid_mode: camera.reidMode ?? "auto",
    reverse_direction: camera.config.reverse,
    roi: toMlRoi(camera.config.roi),
    stream_fps: 24,
    stream_url: camera.rtsp,
    rtsp_stream: camera.rtspStream || null,
    tracking_confidence: camera.trackingConfidence ?? 0.15,
    track_ttl_seconds: 9,
    tripwire_position: camera.config.tripwire / 100,
    unique_counting_mode: camera.uniqueCountingMode ?? "estimated_reid",
  };
  if (credentialScope && window.tanawCameraCredentials) {
    return window.tanawCameraCredentials.request(camera.id, "start", payload) as Promise<{ message: string }>;
  }
  return requestJson<{ message: string }>(
    `${baseUrl}/camera/start`,
    {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        password: credential?.password ?? camera.password ?? null,
        username: credential?.username ?? camera.username ?? null,
      }),
    },
    30_000,
  );
}

export async function updateCameraCountingConfig(
  baseUrl: string,
  camera: Camera,
  options: { requireActiveWorker: boolean },
): Promise<{
  camera_id: number;
  persisted: boolean;
  worker_applied: boolean;
  session_id: number | null;
  raw_frame_id: number | null;
  stream_frame_id: number | null;
}> {
  return requestJson(
    `${baseUrl}/camera/${camera.id}/counting-config`,
    {
      method: "PATCH",
      body: JSON.stringify({
        entry_line: toMlTripwireLine(camera.config.tripwires.entry),
        exit_line: toMlTripwireLine(camera.config.tripwires.exit),
        require_active_worker: options.requireActiveWorker,
        reverse_direction: camera.config.reverse,
        roi: toMlRoi(camera.config.roi),
        tripwire_position: camera.config.tripwire / 100,
      }),
    },
    5000,
  );
}

export async function stopCameraProcessing(baseUrl: string, cameraId: number): Promise<{ message: string }> {
  return requestJson<{ message: string }>(`${baseUrl}/camera/${cameraId}/stop`, { method: "POST" }, 5000);
}

export function getStreamUrl(baseUrl: string, cameraId: number, version: number, overlay = true) {
  const params = new URLSearchParams({ overlay: overlay ? "1" : "0", v: String(version) });
  if (window.tanawMlService) return `tanaw-ml://service/camera/${cameraId}/stream?${params.toString()}`;
  return `${baseUrl}/camera/${cameraId}/stream?${params.toString()}`;
}

export function getMlCameraWebSocketUrl(baseUrl: string) {
  const url = new URL("/camera/ws", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function getPreviewStreamUrl(baseUrl: string, camera: Camera | undefined, version: number, isProcessing: boolean) {
  if (camera && isProcessing) {
    return getStreamUrl(baseUrl, camera.id, version, false);
  }

  return camera ? getStreamUrl(baseUrl, camera.id, version) : "";
}

function toMlTripwireLine(line: Camera["config"]["tripwires"]["entry"]) {
  const normalized = normalizeTripwireLine(line);
  const anchors = getTripwireAnchors(normalized).map(toMlTripwirePoint);
  const sampledPoints = getTripwireSampledPoints(normalized).map(toMlTripwirePoint);

  return {
    start: toMlTripwirePoint(normalized.start),
    end: toMlTripwirePoint(normalized.end),
    points: anchors,
    curve: normalized.curve ?? "smooth",
    sampled_points: sampledPoints,
  };
}

function toMlTripwirePoint(point: Camera["config"]["tripwires"]["entry"]["start"]) {
  return { x: point.x / 100, y: point.y / 100 };
}

function toMlRoi(roi: Camera["config"]["roi"]) {
  return {
    top: roi.top / 100,
    left: roi.left / 100,
    width: roi.width / 100,
    height: roi.height / 100,
  };
}

function queryFromOptions(options: { includeSubmitted?: boolean }) {
  if (!options.includeSubmitted) return "";
  return "?include_submitted=true";
}

async function requestJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  if (window.tanawMlService) {
    try {
      const response = await window.tanawMlService.request({
        body: typeof init.body === "string" ? init.body : undefined,
        method: init.method ?? "GET",
        timeoutMs,
        url,
      });
      if (!response.ok) {
        throw await getRequestError(
          new Response(response.body, { status: response.status, statusText: response.statusText }),
          url,
        );
      }
      return JSON.parse(response.body) as T;
    } catch (error) {
      if (error instanceof MlServiceRequestError) throw error;
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("timeout") || message.includes("timed out") || message.includes("aborted")) {
        throw new MlServiceRequestError("request_timeout", "The ML service did not respond in time.");
      }
      throw new MlServiceRequestError("service_unavailable", "The local ML service is unavailable.");
    }
  }
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: buildHeaders(init),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw await getRequestError(response, url);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new MlServiceRequestError("request_timeout", "The ML service did not respond in time.");
    }

    if (error instanceof TypeError) {
      throw new MlServiceRequestError("service_unavailable", "The local ML service is unavailable.");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function buildHeaders(init: RequestInit) {
  const headers = new Headers(init.headers);
  const hasJsonBody = typeof init.body === "string";

  if (hasJsonBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

async function getRequestError(response: Response, requestUrl: string) {
  let code: MlServiceErrorCode = response.status === 404 ? "camera_not_found" : "unknown";
  let message = `Request failed with status ${response.status}.`;
  try {
    const payload = (await response.json()) as {
      code?: string;
      message?: string;
      detail?: string | { code?: string; message?: string };
    };
    const detail = typeof payload.detail === "object" ? payload.detail : undefined;
    code = normalizeServiceErrorCode(payload.code ?? detail?.code, code);
    message = payload.message ?? detail?.message ?? (typeof payload.detail === "string" ? payload.detail : message);
  } catch {
    // Use the stable status-derived fallback below.
  }

  const pathname = new URL(requestUrl).pathname;
  if (response.status === 404 && pathname === "/cameras/runtime") {
    return new MlServiceRequestError("route_unavailable", "The camera runtime service is unavailable. Restart the local ML service.", response.status);
  }
  if (response.status === 404 && pathname.endsWith("/counting-config") && (message === "Not Found" || message === "Request failed with status 404.")) {
    return new MlServiceRequestError("route_unavailable", "The local ML service does not support live Tripwire updates.", response.status);
  }
  if (response.status === 404 && (message === "Not Found" || message === "Request failed with status 404.")) {
    message = "The requested camera runtime resource is unavailable.";
  }
  return new MlServiceRequestError(code, message, response.status);
}

function normalizeServiceErrorCode(value: string | undefined, fallback: MlServiceErrorCode): MlServiceErrorCode {
  const supported: MlServiceErrorCode[] = [
    "service_unavailable",
    "route_unavailable",
    "camera_not_found",
    "invalid_camera_configuration",
    "stream_unavailable",
    "pipeline_start_failed",
    "capacity_limit",
    "camera_configuration_limit",
    "camera_not_active",
    "tripwire_persistence_failed",
    "tripwire_worker_update_failed",
    "service_shutting_down",
    "request_timeout",
    "unknown",
  ];
  return supported.includes(value as MlServiceErrorCode) ? (value as MlServiceErrorCode) : fallback;
}
