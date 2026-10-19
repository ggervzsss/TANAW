import type { MlAreaState } from "../camera/services/ml-service";

export type AreaMetrics = {
  last_observed_at?: string | null;
  camera_id: number;
  revision_id: string | null;
  revisions: Array<{ revision_id: string; camera_name: string; zone_name: string; created_at: string }>;
  observed_visits: number;
  completed_count: number;
  incomplete_count: number;
  active_count: number;
  average_dwell_ms: number | null;
  median_dwell_ms: number | null;
  p90_dwell_ms: number | null;
  duration_buckets: number[];
  covered_ms: number;
  coverage_ratio: number;
  peak_presence: number | null;
  history: Array<{ at: string; peak_presence: number | null; covered_ms: number; completed_count: number; arrivals?: number }>;
  visits: Array<{ visit_id: string; first_inside_at: string; status: string; estimated_dwell_ms: number; termination_reason: string | null }>;
  total_records: number;
};
export type AreaLive = MlAreaState;
