import type { Camera } from "../../../types/enterprise";
import type { MlOperation } from "../../../../electron/ml-ipc-contract";
import { getTripwireAnchors, getTripwireSampledPoints, normalizeTripwireLine } from "../utils/tripwire-path";

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
  requested_processing_profile: string | null;
  normalized_processing_profile: string | null;
  effective_processing_profile: string | null;
  model_profile: string | null;
  model_name: string | null;
  selected_model: string | null;
  selected_runtime: string | null;
  runtime_backend: string | null;
  runtime_device: string | null;
  requested_runtime: string | null;
  selection_reason: string | null;
  fallback_reason: string | null;
  fallback_chain: string[];
  detector_image_size: number | null;
  detector_max_detections: number | null;
  target_processing_fps: number | null;
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
  estimated_unique_count: number;
  confirmed_unique_count: number;
  degraded_unique_count: number;
  pending_unique_entries: number;
  repeat_entry_count: number;
  tracking_confidence: number | null;
  counting_confidence: number | null;
  reid_mode: string | null;
  effective_reid_mode: string | null;
  unique_counting_mode: string | null;
  requested_tracker: string | null;
  effective_tracker: string | null;
  tracker_profile: string | null;
  tracker_config_path: string | null;
  detector_model_availability: Record<string, unknown>;
  reid_model_availability: Record<string, unknown>;
  runtime_capabilities: Record<string, unknown>;
  reid_tasks_cleared: number;
  reid_worker_alive: boolean;
  quality_reid_tasks_cleared: number;
  quality_reid_worker_alive: boolean;
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
  trigger_point?: [number, number];
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
  counting_debug: Record<string, unknown> | null;
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
  counts: MlCounts;
  updated_at: string | null;
};

export type MlCameraLiveState = {
  counts: MlCounts;
  detections: MlDetections;
  health: MlHealth;
  session: MlSession;
};

export type MlCameraLiveEnvelope = { type: "camera.state"; data: MlCameraLiveState } | { type: "heartbeat" };

export type MlCameraBridgeEvent = MlCameraLiveEnvelope | { type: "service.connection"; data: { connected: boolean } };

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
  estimated_unique_count: number;
  confirmed_unique_count: number;
  degraded_unique_count: number;
  pending_unique_entries: number;
  repeat_entry_count: number;
  occupancy_correction_delta: number;
  total_events: number;
  unsubmitted_events: number;
  unsynced_events: number;
  unclassified_events: number;
  first_event_at: string | null;
  last_event_at: string | null;
  source_kind: "real" | "mock" | "hybrid";
  mock_run_id: string | null;
  period_id: string | null;
  period: string | null;
  starts_at_utc: string | null;
  ends_at_utc: string | null;
  business_start_date: string | null;
  business_end_date_exclusive: string | null;
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

export type LocalReportRevision = LocalMetricsSummary & {
  report_id: string;
  revision_id: string;
  outbox_item_id: string;
  payload_hash: string;
  submitted_at: string;
  sync_status: string;
};

export type LocalReportRecord = {
  report_id: string;
  revision_id: string;
  outbox_item_id: string;
  payload_hash: string;
  period: string;
  period_id: string;
  starts_at_utc: string;
  ends_at_utc: string;
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
  raw_purged_at?: string | null;
};

export type LocalSyncOutboxItem = {
  outbox_item_id: string;
  report_revision_id: string;
  command_id: string;
  idempotency_key: string;
  endpoint: string;
  contract_version: number;
  payload: Record<string, unknown>;
  payload_hash: string;
  status: "ready" | "retry";
  created_at: string;
  next_attempt_at: string;
  attempt_count: number;
  last_attempt_at: string | null;
  last_error_class: string | null;
  last_error_message: string | null;
  acknowledged_at: string | null;
  acknowledgement: Record<string, unknown>;
};

export type LocalSyncOutboxHealth = {
  pending_count: number;
  oldest_pending_at: string | null;
  last_acknowledged_at: string | null;
  last_failure_at: string | null;
  last_failure_class: string | null;
};

export type OccupancyCorrection = {
  correction_id: string;
  enterprise_id: string | null;
  camera_id: number | null;
  old_occupancy: number;
  new_occupancy: number;
  delta: number;
  reason: string;
  actor_id: string | null;
  actor_name: string | null;
  source_kind: "real" | "mock" | "hybrid";
  mock_run_id: string | null;
  recorded_at: string;
};

export type MockPreparationRequest = {
  mockRunId: string;
  enterpriseId: string;
  enterpriseName: string;
  entries: number;
  exits: number;
  uniqueCount: number;
  peakOccupancy: number;
  periodId: string;
  startsAtUtc: string;
  endsAtUtc: string;
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

export const DEFAULT_ML_SERVICE_BASE_URL = "tanaw-ml://local";

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
  void baseUrl;
  return requestMl<MlHealth>("camera.health");
}

export async function getMlCounts(baseUrl: string): Promise<MlCounts> {
  void baseUrl;
  return requestMl<MlCounts>("camera.counts");
}

export async function getMlSession(baseUrl: string): Promise<MlSession> {
  void baseUrl;
  return requestMl<MlSession>("camera.session");
}

export async function setMlEnterpriseContext(baseUrl: string, enterpriseId: string, enterpriseName?: string | null): Promise<MlEnterpriseContext> {
  void baseUrl;
  return requestMl<MlEnterpriseContext>("context.enterprise", {
    enterprise_id: enterpriseId,
    enterprise_name: enterpriseName || null,
  });
}

export async function restoreMlSession(baseUrl: string): Promise<MlSession> {
  void baseUrl;
  return requestMl<MlSession>("session.restore");
}

export async function getLocalMetricsSummary(baseUrl: string, options: { includeSubmitted?: boolean } = {}): Promise<LocalMetricsSummary> {
  void baseUrl;
  return requestMl<LocalMetricsSummary>("metrics.summary", { includeSubmitted: Boolean(options.includeSubmitted) });
}

export async function getLocalMetricsHistory(baseUrl: string, options: { includeSubmitted?: boolean } = {}): Promise<LocalMetricsHistory> {
  void baseUrl;
  return requestMl<LocalMetricsHistory>("metrics.history", { includeSubmitted: Boolean(options.includeSubmitted) });
}

export async function recordOccupancyCorrection(
  baseUrl: string,
  payload: { newOccupancy: number; reason: string; cameraId?: number | null },
): Promise<OccupancyCorrection> {
  void baseUrl;
  return requestMl<OccupancyCorrection>("occupancy.correction", {
    new_occupancy: payload.newOccupancy,
    reason: payload.reason,
    camera_id: payload.cameraId ?? null,
  });
}

export async function recordLocalReportRevision(
  baseUrl: string,
  payload: {
    metrics: { entries: number; exits: number; peakOccupancy: number; uniqueCount: number };
    notes: string;
    periodId: string;
    startsAtUtc: string;
    endsAtUtc: string;
    reportId: string;
    reportPayload: Record<string, unknown>;
  },
): Promise<LocalReportRevision> {
  void baseUrl;
  return requestMl<LocalReportRevision>("reports.createRevision", {
    metrics: {
      entries: payload.metrics.entries,
      exits: payload.metrics.exits,
      peak_occupancy: payload.metrics.peakOccupancy,
      unique_count: payload.metrics.uniqueCount,
    },
    notes: payload.notes || null,
    payload: payload.reportPayload,
    period_id: payload.periodId,
    report_id: payload.reportId,
    source_window: {
      start: payload.startsAtUtc,
      end: payload.endsAtUtc,
    },
  });
}

export async function listLocalReports(baseUrl: string, limit = 100): Promise<LocalReportRecord[]> {
  void baseUrl;
  return requestMl<LocalReportRecord[]>("reports.list", { limit });
}

export async function listReadySyncOutboxItems(baseUrl: string, limit = 100): Promise<LocalSyncOutboxItem[]> {
  void baseUrl;
  return requestMl<LocalSyncOutboxItem[]>("sync.outbox.ready", { limit });
}

export async function getSyncOutboxHealth(baseUrl: string): Promise<LocalSyncOutboxHealth> {
  void baseUrl;
  return requestMl<LocalSyncOutboxHealth>("sync.outbox.health");
}

export async function acknowledgeSyncOutboxItem(baseUrl: string, outboxItemId: string, acknowledgement: Record<string, unknown>): Promise<{ acknowledged: true; outbox_item_id: string }> {
  void baseUrl;
  return requestMl<{ acknowledged: true; outbox_item_id: string }>("sync.outbox.acknowledge", { outboxItemId, acknowledgement });
}

export async function recordSyncOutboxFailure(
  baseUrl: string,
  outboxItemId: string,
  failure: { errorClass: string; errorMessage: string; retryable: boolean; httpStatus?: number | null },
): Promise<LocalSyncOutboxItem> {
  void baseUrl;
  return requestMl<LocalSyncOutboxItem>("sync.outbox.failure", {
    outboxItemId,
    error_class: failure.errorClass,
    error_message: failure.errorMessage,
    retryable: failure.retryable,
    http_status: failure.httpStatus ?? null,
  });
}

export async function purgeLocalReportRawEvents(baseUrl: string, reportId: string): Promise<{ report_id: string; purged_events: number; raw_purged_at: string | null }> {
  void baseUrl;
  return requestMl<{ report_id: string; purged_events: number; raw_purged_at: string | null }>("reports.purgeRaw", { reportId });
}

export async function prepareLocalMockCounts(baseUrl: string, payload: MockPreparationRequest): Promise<LocalMetricsSummary & { prepared: boolean }> {
  void baseUrl;
  return requestMl<LocalMetricsSummary & { prepared: boolean }>("simulation.prepare", {
    mock_run_id: payload.mockRunId,
    enterprise_id: payload.enterpriseId,
    enterprise_name: payload.enterpriseName,
    entries: payload.entries,
    exits: payload.exits,
    unique_count: payload.uniqueCount,
    peak_occupancy: payload.peakOccupancy,
    period_id: payload.periodId,
    source_window: {
      start: payload.startsAtUtc,
      end: payload.endsAtUtc,
    },
  });
}

export async function resetLocalMockData(baseUrl: string, mockRunId: string): Promise<{ stopped: boolean; removed: Record<string, number> }> {
  void baseUrl;
  return requestMl<{ stopped: boolean; removed: Record<string, number> }>("simulation.reset", { mockRunId });
}

export async function getSimulationStatus(baseUrl: string): Promise<SimulationStatus> {
  void baseUrl;
  return requestMl<SimulationStatus>("simulation.status");
}

export async function startSimulation(baseUrl: string, payload: SimulationStartRequest): Promise<SimulationStatus> {
  void baseUrl;
  return requestMl<SimulationStatus>("simulation.start", {
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
  });
}

export async function pauseSimulation(baseUrl: string): Promise<SimulationStatus> {
  void baseUrl;
  return requestMl<SimulationStatus>("simulation.pause");
}

export async function resumeSimulation(baseUrl: string): Promise<SimulationStatus> {
  void baseUrl;
  return requestMl<SimulationStatus>("simulation.resume");
}

export async function stopSimulation(baseUrl: string): Promise<SimulationStatus> {
  void baseUrl;
  return requestMl<SimulationStatus>("simulation.stop");
}

export async function appendSimulationEvent(baseUrl: string, direction: "entry" | "exit"): Promise<SimulationStatus> {
  void baseUrl;
  return requestMl<SimulationStatus>("simulation.event", { direction });
}

export async function resetSimulation(baseUrl: string, runId: string): Promise<{ stopped: boolean; removed: Record<string, number> }> {
  return resetLocalMockData(baseUrl, runId);
}

export async function getMlDetections(baseUrl: string): Promise<MlDetections> {
  void baseUrl;
  return requestMl<MlDetections>("camera.detections");
}

export async function testCameraConnection(baseUrl: string, camera: Camera, credentialScope: string): Promise<CameraTestResult> {
  void baseUrl;
  return requestMl<CameraTestResult>("camera.test", {
    cameraId: camera.id,
    credentialScope,
    body: {
      camera_type: camera.cameraType,
      stream_url: camera.rtsp,
    },
  });
}

export async function startCameraProcessing(baseUrl: string, camera: Camera, credentialScope: string): Promise<{ message: string }> {
  void baseUrl;
  return requestMl<{ message: string }>("camera.start", {
    cameraId: camera.id,
    credentialScope,
    body: {
      camera_name: camera.name,
      camera_id: camera.id,
      camera_type: camera.cameraType,
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
      tracking_confidence: camera.trackingConfidence ?? 0.15,
      track_ttl_seconds: 9,
      tripwire_position: camera.config.tripwire / 100,
      unique_counting_mode: camera.uniqueCountingMode ?? "estimated_reid",
    },
  });
}

export async function stopCameraProcessing(baseUrl: string): Promise<{ message: string }> {
  void baseUrl;
  return requestMl<{ message: string }>("camera.stop");
}

export function getStreamUrl(baseUrl: string, version: number, overlay = true) {
  void baseUrl;
  const params = new URLSearchParams({ overlay: overlay ? "1" : "0", v: String(version) });
  return `tanaw-ml://stream/?${params.toString()}`;
}

export function subscribeMlCameraEvents(listener: (event: MlCameraBridgeEvent) => void) {
  if (!window.tanawMlService) return () => undefined;
  void getMlServiceStatus().then((status) => listener({ type: "service.connection", data: { connected: status.running } }));
  return window.tanawMlService.onCameraEvent((event) => {
    if (isMlCameraBridgeEvent(event)) listener(event);
  });
}

export function getPreviewStreamUrl(baseUrl: string, camera: Camera | undefined, version: number, isProcessing: boolean) {
  void camera;
  return getStreamUrl(baseUrl, version, !isProcessing);
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

async function requestMl<T>(operation: MlOperation, payload?: unknown): Promise<T> {
  if (!window.tanawMlService) {
    throw new Error("Electron ML service bridge is unavailable.");
  }
  return window.tanawMlService.request<T>(operation, payload);
}

function isMlCameraBridgeEvent(event: unknown): event is MlCameraBridgeEvent {
  if (!event || typeof event !== "object") return false;
  const candidate = event as { data?: unknown; type?: unknown };
  if (candidate.type === "heartbeat") return Object.keys(candidate).length === 1;
  if (candidate.type === "service.connection") {
    return Boolean(candidate.data && typeof candidate.data === "object" && typeof (candidate.data as { connected?: unknown }).connected === "boolean");
  }
  if (candidate.type !== "camera.state" || !candidate.data || typeof candidate.data !== "object" || Array.isArray(candidate.data)) return false;
  const data = candidate.data as Record<string, unknown>;
  const counts = data.counts;
  const detections = data.detections;
  const session = data.session;
  return Boolean(
    Object.keys(data).sort().join("|") === "counts|detections|health|session" &&
    counts &&
    typeof counts === "object" &&
    typeof (counts as { running?: unknown }).running === "boolean" &&
    detections &&
    typeof detections === "object" &&
    Array.isArray((detections as { tracks?: unknown }).tracks) &&
    session &&
    typeof session === "object" &&
    !("camera_config" in session) &&
    typeof (session as { running?: unknown }).running === "boolean",
  );
}
