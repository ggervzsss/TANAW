import type { Camera, Metrics, ReportRecord } from "../types/enterprise";
import type { LocalMetricsHistory } from "../features/camera/services/ml-service";

export const EMPTY_METRICS: Metrics = {
  entries: 0,
  exits: 0,
  peak: 0,
  unique: 0,
};

export const EMPTY_LOCAL_METRICS_HISTORY: LocalMetricsHistory = {
  hourly_density: [],
  historical: {
    Today: [],
    Week: [],
    Month: [],
  },
};

export const REPORTING_PERIODS = ["Current Period"] as const;

export const EMPTY_REPORTS: ReportRecord[] = [];
export const EMPTY_CAMERAS: Camera[] = [];
