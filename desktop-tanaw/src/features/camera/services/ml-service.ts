import type { Camera } from "../../../types/enterprise";

export type MlServiceStatus = {
  baseUrl: string;
  error: string | null;
  pid: number | null;
  running: boolean;
};

export type MlHealth = {
  status: "ok";
  running: boolean;
  error: string | null;
  model_loaded: boolean;
  model_ready: boolean;
  model_loading: boolean;
  device: string | null;
  model_path: string | null;
  reid_model_loaded: boolean;
  reid_model_ready: boolean;
  reid_model_loading: boolean;
  reid_status: string | null;
  reid_model_path: string | null;
  reid_error: string | null;
  reid_average_inference_ms: number | null;
  reid_providers: string[];
  reid_gallery_size: number;
  reid_quality_gallery_size: number;
  reid_business_date: string | null;
  reid_last_cleanup_at: string | null;
  quality_reid_model_loaded: boolean;
  quality_reid_model_ready: boolean;
  quality_reid_model_loading: boolean;
  quality_reid_status: string | null;
  quality_reid_model_path: string | null;
  quality_reid_error: string | null;
  quality_reid_average_inference_ms: number | null;
  quality_reid_providers: string[];
  quality_reid_queue_depth: number;
  quality_reid_tasks_pending: number;
  quality_reid_tasks_dropped: number;
  quality_reid_tasks_completed: number;
  quality_reid_worker_p50_ms: number | null;
  quality_reid_worker_p95_ms: number | null;
  processing_profile: string | null;
  detector_image_size: number | null;
  detector_p50_ms: number | null;
  detector_p95_ms: number | null;
  analytics_fps: number | null;
  processing_frame_age_ms: number | null;
  processing_frames_skipped: number;
  reid_queue_depth: number;
  reid_tasks_pending: number;
  reid_tasks_dropped: number;
  reid_tasks_completed: number;
  reid_worker_p50_ms: number | null;
  reid_worker_p95_ms: number | null;
  identity_active_tracks: number;
  identity_stitches: number;
  identity_splits: number;
  confirmed_unique_count: number;
  degraded_unique_count: number;
};

export type MlCounts = {
  entry: number;
  exit: number;
  occupancy: number;
  running: boolean;
  status: string;
  started_at: string | null;
  error: string | null;
};

export type MlDetectionTrack = {
  track_id: number;
  source_track_id: number;
  bbox: [number, number, number, number];
  confidence: number;
  centroid: [number, number];
  direction: string | null;
  visitor_id: string | null;
  is_unique_entry: boolean | null;
  reid_score: number | null;
  reid_decision: string | null;
  identity_confidence: string | null;
  inside_roi: boolean | null;
  counting_eligible: boolean | null;
  identity_state: string | null;
  identity_score: number | null;
  identity_source: string | null;
};

export type MlDetections = {
  running: boolean;
  status: string;
  error: string | null;
  frame_width: number | null;
  frame_height: number | null;
  tracks: MlDetectionTrack[];
};

export type MlSession = {
  running: boolean;
  status: string;
  error: string | null;
  camera_id: number | null;
  camera_name: string | null;
  camera_config: Record<string, unknown> | null;
  counts: MlCounts;
  updated_at: string | null;
};

export type MlEnterpriseContext = {
  enterprise_id: string;
  enterprise_name: string | null;
  changed: boolean;
  session_restored: boolean;
};

export type LocalMetricsSummary = {
  entries: number;
  exits: number;
  peak_occupancy: number;
  current_occupancy: number;
  unique_count: number;
  confirmed_unique_count: number;
  degraded_unique_count: number;
  total_events: number;
  unsubmitted_events: number;
  unsynced_events: number;
  first_event_at: string | null;
  last_event_at: string | null;
  source_kind?: "real" | "mock" | "hybrid";
  mock_run_id?: string | null;
};

export type LocalHourlyDensityPoint = {
  time: string;
  occupancy: number;
  entry: number;
  exit: number;
  unique: number;
};

export type LocalHistoricalMetricsPoint = {
  label: string;
  visitors: number;
  entries: number;
  exits: number;
  peak_occupancy: number;
  current_occupancy: number;
};

export type LocalMetricsHistory = {
  hourly_density: LocalHourlyDensityPoint[];
  historical: {
    Today: LocalHistoricalMetricsPoint[];
    Week: LocalHistoricalMetricsPoint[];
    Month: LocalHistoricalMetricsPoint[];
  };
};

export type LocalReportSubmission = LocalMetricsSummary & {
  report_id: string;
  submitted_at: string;
  sync_status: string;
};

export type LocalReportSubmissionRecord = {
  report_id: string;
  period: string;
  submitted_at: string;
  entries: number;
  exits: number;
  peak_occupancy: number;
  unique_count: number;
  notes: string | null;
  payload: Record<string, unknown>;
  sync_status: string;
  source_kind?: "real" | "mock" | "hybrid";
  mock_run_id?: string | null;
  synced_at: string | null;
};

export type MockPreparationRequest = {
  mockRunId: string;
  enterpriseId: string;
  enterpriseName: string;
  entries: number;
  exits: number;
  uniqueCount: number;
  peakOccupancy: number;
  period: string;
};

export type SimulationScenario = "normal" | "morning-rush" | "event-opening" | "overcrowding" | "evacuation" | "custom";

export type SimulationStartRequest = {
  runId: string;
  scenario: SimulationScenario;
  eventsPerMinute: number;
  capacity: number;
  startingOccupancy: number;
  durationMinutes: number | null;
  thresholdPercent: number;
  entryProbability: number | null;
  uniqueEntryRate: number;
};

export type SimulationStatus = {
  running: boolean;
  paused: boolean;
  state: "idle" | "running" | "paused" | "stopped" | "completed";
  mode: string | null;
  scenario: SimulationScenario | null;
  mock_run_id: string | null;
  events_generated: number;
  events_per_minute: number;
  requires_real_camera: boolean;
  enterprise_id: string | null;
  enterprise_name: string | null;
  capacity: number;
  threshold_percent: number;
  duration_minutes: number | null;
  started_at: string | null;
  completed_at: string | null;
  entries: number;
  exits: number;
  current_occupancy: number;
  peak_occupancy: number;
  unique_count: number;
  unsubmitted_events: number;
};

export type CameraTestResult = {
  ok: boolean;
  message: string;
};

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
      return await window.tanawMlService.getStatus();
    } catch {
      return { baseUrl: DEFAULT_ML_SERVICE_BASE_URL, error: "Electron ML service bridge is unavailable.", pid: null, running: false };
    }
  }

  return { baseUrl: DEFAULT_ML_SERVICE_BASE_URL, error: null, pid: null, running: false };
}

export async function restartMlService(): Promise<MlServiceStatus> {
  if (!window.tanawMlService) {
    return { baseUrl: DEFAULT_ML_SERVICE_BASE_URL, error: "Restart is only available inside Electron.", pid: null, running: false };
  }

  return window.tanawMlService.restart();
}

export async function getMlHealth(baseUrl: string): Promise<MlHealth> {
  return requestJson<MlHealth>(`${baseUrl}/health`, { method: "GET" }, 2500);
}

export async function getMlCounts(baseUrl: string): Promise<MlCounts> {
  return requestJson<MlCounts>(`${baseUrl}/counts`, { method: "GET" }, 2500);
}

export async function getMlSession(baseUrl: string): Promise<MlSession> {
  return requestJson<MlSession>(`${baseUrl}/session`, { method: "GET" }, 2500);
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

export async function restoreMlSession(baseUrl: string): Promise<MlSession> {
  return requestJson<MlSession>(`${baseUrl}/session/restore`, { method: "POST" }, 8000);
}

export async function getLocalMetricsSummary(baseUrl: string, options: { includeSubmitted?: boolean } = {}): Promise<LocalMetricsSummary> {
  return requestJson<LocalMetricsSummary>(`${baseUrl}/metrics/summary${queryFromOptions(options)}`, { method: "GET" }, 2500);
}

export async function getLocalMetricsHistory(baseUrl: string, options: { includeSubmitted?: boolean } = {}): Promise<LocalMetricsHistory> {
  return requestJson<LocalMetricsHistory>(`${baseUrl}/metrics/history${queryFromOptions(options)}`, { method: "GET" }, 2500);
}

export async function recordLocalReportSubmission(
  baseUrl: string,
  payload: { reportId: string; period: string; notes: string; reportPayload: Record<string, unknown> },
): Promise<LocalReportSubmission> {
  return requestJson<LocalReportSubmission>(
    `${baseUrl}/reports/local-submit`,
    {
      method: "POST",
      body: JSON.stringify({
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

export async function markLocalReportSynced(baseUrl: string, reportId: string): Promise<{ updated: number }> {
  return requestJson<{ updated: number }>(`${baseUrl}/reports/local/${encodeURIComponent(reportId)}/synced`, { method: "POST" }, 2500);
}

export async function markLocalEventsSynced(baseUrl: string): Promise<{ updated: number }> {
  return requestJson<{ updated: number }>(`${baseUrl}/metrics/mark-synced`, { method: "POST" }, 2500);
}

export async function prepareLocalMockCounts(baseUrl: string, payload: MockPreparationRequest): Promise<LocalMetricsSummary & { prepared: boolean }> {
  return requestJson<LocalMetricsSummary & { prepared: boolean }>(
    `${baseUrl}/mock/prepare`,
    {
      method: "POST",
      body: JSON.stringify({
        mock_run_id: payload.mockRunId,
        enterprise_id: payload.enterpriseId,
        enterprise_name: payload.enterpriseName,
        entries: payload.entries,
        exits: payload.exits,
        unique_count: payload.uniqueCount,
        peak_occupancy: payload.peakOccupancy,
        period: payload.period,
      }),
    },
    15_000,
  );
}

export async function resetLocalMockData(baseUrl: string, mockRunId: string): Promise<{ stopped: boolean; removed: Record<string, number> }> {
  const params = new URLSearchParams({ mock_run_id: mockRunId });
  return requestJson<{ stopped: boolean; removed: Record<string, number> }>(`${baseUrl}/mock/reset?${params.toString()}`, { method: "POST" }, 5000);
}

export async function getSimulationStatus(baseUrl: string): Promise<SimulationStatus> {
  return requestJson<SimulationStatus>(`${baseUrl}/mock/status`, { method: "GET" }, 2500);
}

export async function startSimulation(baseUrl: string, payload: SimulationStartRequest): Promise<SimulationStatus> {
  return requestJson<SimulationStatus>(
    `${baseUrl}/mock/start`,
    {
      method: "POST",
      body: JSON.stringify({
        mock_run_id: payload.runId,
        mode: "virtual",
        scenario: payload.scenario,
        events_per_minute: payload.eventsPerMinute,
        capacity: payload.capacity,
        starting_occupancy: payload.startingOccupancy,
        duration_minutes: payload.durationMinutes,
        threshold_percent: payload.thresholdPercent,
        entry_probability: payload.entryProbability,
        unique_entry_rate: payload.uniqueEntryRate,
      }),
    },
    15_000,
  );
}

export async function pauseSimulation(baseUrl: string): Promise<SimulationStatus> {
  return requestJson<SimulationStatus>(`${baseUrl}/mock/pause`, { method: "POST" }, 5000);
}

export async function resumeSimulation(baseUrl: string): Promise<SimulationStatus> {
  return requestJson<SimulationStatus>(`${baseUrl}/mock/resume`, { method: "POST" }, 5000);
}

export async function stopSimulation(baseUrl: string): Promise<SimulationStatus> {
  return requestJson<SimulationStatus>(`${baseUrl}/mock/stop`, { method: "POST" }, 5000);
}

export async function appendSimulationEvent(baseUrl: string, direction: "entry" | "exit"): Promise<SimulationStatus> {
  return requestJson<SimulationStatus>(`${baseUrl}/mock/event`, { method: "POST", body: JSON.stringify({ direction }) }, 5000);
}

export async function resetSimulation(baseUrl: string, runId: string): Promise<{ stopped: boolean; removed: Record<string, number> }> {
  return resetLocalMockData(baseUrl, runId);
}

export async function getMlDetections(baseUrl: string): Promise<MlDetections> {
  return requestJson<MlDetections>(`${baseUrl}/detections`, { method: "GET" }, 2500);
}

export async function testCameraConnection(baseUrl: string, camera: Camera): Promise<CameraTestResult> {
  return requestJson<CameraTestResult>(
    `${baseUrl}/camera/test`,
    {
      method: "POST",
      body: JSON.stringify({
        camera_type: camera.cameraType,
        password: camera.password || null,
        stream_url: camera.rtsp,
        username: camera.username || null,
      }),
    },
    8000,
  );
}

export async function startCameraProcessing(baseUrl: string, camera: Camera): Promise<{ message: string }> {
  return requestJson<{ message: string }>(
    `${baseUrl}/camera/start`,
    {
      method: "POST",
      body: JSON.stringify({
        camera_name: camera.name,
        camera_id: camera.id,
        camera_type: camera.cameraType,
        confidence: camera.confidence,
        entry_line: toMlTripwireLine(camera.config.tripwires.entry),
        event_cooldown_seconds: 3.6,
        exit_line: toMlTripwireLine(camera.config.tripwires.exit),
        paired_line_max_gap_seconds: 18,
        password: camera.password || null,
        processing_profile: camera.processingProfile,
        reverse_direction: camera.config.reverse,
        roi: toMlRoi(camera.config.roi),
        stream_fps: 24,
        stream_url: camera.rtsp,
        track_ttl_seconds: 9,
        tripwire_position: camera.config.tripwire / 100,
        username: camera.username || null,
      }),
    },
    30_000,
  );
}

export async function stopCameraProcessing(baseUrl: string): Promise<{ message: string }> {
  return requestJson<{ message: string }>(`${baseUrl}/camera/stop`, { method: "POST" }, 5000);
}

export function getStreamUrl(baseUrl: string, version: number) {
  return `${baseUrl}/stream?v=${version}`;
}

export function getPreviewStreamUrl(baseUrl: string, camera: Camera | undefined, version: number) {
  if (camera && isNativeBrowserMjpegCamera(camera)) {
    return camera.rtsp.trim();
  }

  return getStreamUrl(baseUrl, version);
}

function isNativeBrowserMjpegCamera(camera: Camera) {
  return camera.cameraType === "IP_WEBCAM" && /^https?:\/\//i.test(camera.rtsp.trim());
}

function toMlTripwireLine(line: Camera["config"]["tripwires"]["entry"]) {
  return {
    start: { x: line.start.x / 100, y: line.start.y / 100 },
    end: { x: line.end.x / 100, y: line.end.y / 100 },
  };
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
      throw new Error(await getErrorMessage(response));
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The ML service did not respond in time.");
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

async function getErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { detail?: string };
    return payload.detail ?? `Request failed with status ${response.status}.`;
  } catch {
    return `Request failed with status ${response.status}.`;
  }
}
