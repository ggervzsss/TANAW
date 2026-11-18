export type ReconciliationState = "not_collected" | "partial" | "estimated";
export type MeasurementState = "available" | "partial" | "unavailable";

export type DailyEstablishmentMetrics = {
  business_date: string;
  unique_count: number;
  confirmed_unique_count: number;
  /** TANAW's male/female split of the unique visitors; null when estimation was unavailable. */
  male_count?: number | null;
  female_count?: number | null;
  sex_estimation_state?: "estimated" | "partial" | "unavailable";
  sex_evidence_share?: number | null;
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
};

export type EstablishmentSummary = Pick<
  DailyEstablishmentMetrics,
  | "unique_count"
  | "confirmed_unique_count"
  | "male_count"
  | "female_count"
  | "sex_estimation_state"
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
  /** estimated: every camera counting · partial: some cameras offline · unavailable: none counting. */
  state: "estimated" | "partial" | "unavailable";
  contributions: Array<{
    camera_ids: number[];
    occupancy: number;
    state: "estimated";
    /** All Entry / Exit doors share one balance; each Open Space area adds its people. */
    basis: "entry_exit_balance" | "observed_presence";
  }>;
  missing_camera_ids: number[];
  movement_available: boolean;
  identification_available: boolean;
};

/** One local hour of day, added up across the requested days. */
export type HourlyEstablishmentActivity = {
  hour: number;
  entries: number;
  area_visits: number;
  peak_occupancy: number | null;
  covered_ms: number;
};

export type EstablishmentHourly = {
  enterprise_id: string;
  from_at: string;
  to_at: string;
  timezone: "Asia/Manila";
  days_requested: number;
  days_retained: number;
  /** "partial" when some requested days are older than the 30-day observation retention. */
  state: "available" | "partial" | "unavailable";
  hours: HourlyEstablishmentActivity[];
};
