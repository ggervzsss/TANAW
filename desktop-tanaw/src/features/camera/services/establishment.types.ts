export type ReconciliationState = "configuration_required" | "not_collected" | "partial" | "estimated";
export type MeasurementState = "available" | "partial" | "unavailable";

export type DailyEstablishmentMetrics = {
  business_date: string;
  unique_count: number;
  confirmed_unique_count: number;
  entries: number;
  exits: number;
  repeat_entry_count: number;
  unresolved_observations: number;
  qualified_observations: number;
  identification_coverage: number | null;
  identification_state: MeasurementState;
  reconciliation_state: ReconciliationState;
  movement_state: MeasurementState;
  peak_occupancy: number | null;
  covered_ms: number;
  coverage_ratio: number;
  counting_basis: "sum_of_daily_establishment_unique_visitors";
  policy_version: number;
  finalized: boolean;
  first_event_at: string | null;
  last_event_at: string | null;
  sources: number[];
  incompatible_identity_models: boolean;
  unconfigured_camera_pairs: Array<[number, number]>;
};

export type EstablishmentSummary = Pick<
  DailyEstablishmentMetrics,
  | "unique_count"
  | "confirmed_unique_count"
  | "entries"
  | "exits"
  | "repeat_entry_count"
  | "unresolved_observations"
  | "qualified_observations"
  | "peak_occupancy"
  | "covered_ms"
  | "counting_basis"
  | "policy_version"
  | "reconciliation_state"
  | "movement_state"
  | "identification_state"
  | "coverage_ratio"
> & {
  enterprise_id: string;
  from_at: string;
  to_at: string;
  timezone: "Asia/Manila";
  days: DailyEstablishmentMetrics[];
  days_available: number;
  days_requested: number;
  snapshot_version: string;
  occupancy_corrections?: Array<{ recorded_at: string; old_occupancy: number; new_occupancy: number; reason: string }>;
  source_breakdown: Array<{
    camera_id: number;
    camera_name: string;
    analysis_modes: Array<"entrance_exit" | "open_space">;
    entries: number | null;
    exits: number | null;
    unique_count: number;
    qualified_observations: number;
    additive: false;
  }>;
};

export type EstablishmentReportPeriod = {
  period: string;
  metrics: { entries: number | null; exits: number | null; peak_occupancy: number | null; unique_count: number };
  counting: EstablishmentSummary;
};

export type EstablishmentLive = {
  enterprise_id: string;
  occupancy: number | null;
  partial_occupancy: number;
  state: "estimated" | "partial" | "unavailable" | "configuration_required";
  contributions: Array<{
    camera_ids: number[];
    occupancy: number;
    state: "estimated" | "partial";
    basis: "boundary_balance" | "observed_presence" | "observed_presence_and_later_movements";
    population_keys?: string[];
  }>;
  missing_camera_ids: number[];
  excluded_camera_ids: number[];
  movement_available: boolean;
  identification_available: boolean;
};
