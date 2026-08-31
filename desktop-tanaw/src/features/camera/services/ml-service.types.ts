export type MlServiceStatus = {
  baseUrl: string;
  desktopBuild: string;
  desktopVersion: string;
  error: string | null;
  packaged: boolean;
  pid: number | null;
  running: boolean;
};

export type MlHealth = {
  status: "ok";
  service_version: string;
  api_contract_version: number;
  tripwire_hot_update: boolean;
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
  reid_provisional_gallery_size: number;
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
  raw_frame_id: number;
  processed_frame_id: number;
  stream_frame_id: number;
  raw_frame_stale_ms: number | null;
  processed_frame_stale_ms: number | null;
  stream_frame_stale_ms: number | null;
  reid_queue_depth: number;
  reid_tasks_pending: number;
  reid_tasks_dropped: number;
  reid_tasks_completed: number;
  reid_worker_p50_ms: number | null;
  reid_worker_p95_ms: number | null;
  identity_active_tracks: number;
  identity_stitches: number;
  identity_splits: number;
  identity_active_swaps: number;
  identity_pending_swaps: number;
  reid_results_stale: number;
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
  active_camera_count: number;
  max_configured_cameras: number;
  max_concurrent_cameras: number;
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
  camera_config: Record<string, unknown> | null;
  counts: MlCounts;
  updated_at: string | null;
};

export type MlCameraLiveState = {
  enterprise_id: string;
  camera_id: number;
  counts: MlCounts;
  detections: MlDetections;
  health: MlHealth;
  session: MlSession;
};

export type MlCameraStates = {
  enterprise_id: string;
  enterprise_occupancy: number;
  active_camera_count: number;
  max_configured_cameras: number;
  max_concurrent_cameras: number;
  pending_camera_ids: number[];
  cameras: MlCameraLiveState[];
};

export type MlCameraLiveEnvelope = { type: "camera.states"; data: MlCameraStates } | { type: "heartbeat" };

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
  first_event_at: string | null;
  last_event_at: string | null;
  period?: string | null;
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
  submission_id: string;
  submitted_at: string;
  sync_status: string;
  camera_breakdown: LocalReportCameraTotal[];
};

export type LocalReportCameraTotal = {
  camera_id: number | null;
  camera_name: string | null;
  entries: number;
  exits: number;
  peak_occupancy: number;
  unique_count: number;
  total_events: number;
};

export type LocalReportSubmissionRecord = {
  report_id: string;
  submission_id: string;
  period: string;
  submitted_at: string;
  entries: number;
  exits: number;
  peak_occupancy: number;
  unique_count: number;
  notes: string | null;
  payload: Record<string, unknown>;
  sync_status: string;
  synced_at: string | null;
  raw_purged_at?: string | null;
  camera_breakdown: LocalReportCameraTotal[];
};

export type LocalReportDraft = {
  draft_key: string;
  period: string;
  report_id: string | null;
  payload: Record<string, unknown>;
  updated_at: string;
};

export type SamplePreparationRequest = {
  enterpriseId: string;
  enterpriseName: string;
  entries: number;
  exits: number;
  uniqueCount: number;
  peakOccupancy: number;
  period: string;
  reportId: string;
};

export type CameraTestResult = {
  ok: boolean;
  message: string;
};

export type MlServiceErrorCode =
  | "service_unavailable"
  | "route_unavailable"
  | "camera_not_found"
  | "invalid_camera_configuration"
  | "stream_unavailable"
  | "pipeline_start_failed"
  | "capacity_limit"
  | "camera_configuration_limit"
  | "camera_not_active"
  | "tripwire_persistence_failed"
  | "tripwire_worker_update_failed"
  | "service_shutting_down"
  | "request_timeout"
  | "unknown";

export class MlServiceRequestError extends Error {
  constructor(
    public readonly code: MlServiceErrorCode,
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "MlServiceRequestError";
  }
}
