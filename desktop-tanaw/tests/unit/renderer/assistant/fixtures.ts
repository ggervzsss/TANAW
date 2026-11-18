import type { DailyEstablishmentMetrics, EstablishmentHourly, EstablishmentLive, EstablishmentSummary } from "../../../../src/features/camera/services/establishment.types";
import type { AssistantData, ComposeContext, PeriodKey, Plan } from "../../../../src/features/dashboard/assistant/types";

/** 3:42 PM on Wednesday 18 November 2026 in Manila. */
export const NOW = new Date("2026-11-18T07:42:00Z");
export const CONTEXT: ComposeContext = { now: NOW, timeFormat: "12-hour" };

export function day(business_date: string, overrides: Partial<DailyEstablishmentMetrics> = {}): DailyEstablishmentMetrics {
  return {
    business_date,
    unique_count: 0,
    confirmed_unique_count: 0,
    male_count: null,
    female_count: null,
    sex_estimation_state: "unavailable",
    sex_evidence_share: null,
    entries: 0,
    exits: 0,
    repeat_entry_count: 0,
    unresolved_observations: 0,
    qualified_observations: 1,
    identification_coverage: 1,
    identification_state: "available",
    reconciliation_state: "estimated",
    movement_state: "available",
    peak_occupancy: 0,
    covered_ms: 3_600_000,
    coverage_ratio: 1 / 24,
    counting_basis: "sum_of_daily_establishment_unique_visitors",
    policy_version: 3,
    finalized: false,
    first_event_at: null,
    last_event_at: null,
    sources: [1],
    incompatible_identity_models: false,
    ...overrides,
  };
}

/** A summary for today (or ``from_at``/``to_at`` overrides), fully observed so far. */
export function summary(overrides: Partial<EstablishmentSummary> = {}): EstablishmentSummary {
  const from_at = overrides.from_at ?? "2026-11-17T16:00:00+00:00";
  const to_at = overrides.to_at ?? "2026-11-18T16:00:00+00:00";
  const elapsed = Math.min(NOW.getTime(), Date.parse(to_at)) - Date.parse(from_at);
  const days = overrides.days ?? [day("2026-11-18", { unique_count: 132, entries: 150, exits: 120, peak_occupancy: 48 })];
  return {
    enterprise_id: "park",
    from_at,
    to_at,
    timezone: "Asia/Manila",
    days,
    days_available: days.length,
    days_requested: Math.round((Date.parse(to_at) - Date.parse(from_at)) / 86_400_000),
    snapshot_version: "v",
    source_breakdown: [],
    unique_count: 132,
    confirmed_unique_count: 132,
    male_count: null,
    female_count: null,
    sex_estimation_state: "unavailable",
    entries: 150,
    exits: 120,
    repeat_entry_count: 0,
    unresolved_observations: 0,
    qualified_observations: 150,
    peak_occupancy: 48,
    covered_ms: elapsed,
    coverage_ratio: elapsed / (Date.parse(to_at) - Date.parse(from_at)),
    counting_basis: "sum_of_daily_establishment_unique_visitors",
    policy_version: 3,
    reconciliation_state: "estimated",
    movement_state: "available",
    identification_state: "available",
    ...overrides,
  };
}

export function hourly(hours: Partial<Record<number, { entries?: number; area_visits?: number; peak_occupancy?: number | null }>>, overrides: Partial<EstablishmentHourly> = {}): EstablishmentHourly {
  return {
    enterprise_id: "park",
    from_at: "2026-11-17T16:00:00+00:00",
    to_at: "2026-11-18T16:00:00+00:00",
    timezone: "Asia/Manila",
    days_requested: 1,
    days_retained: 1,
    state: "available",
    hours: Array.from({ length: 24 }, (_, hour) => ({ hour, entries: 0, area_visits: 0, peak_occupancy: null, covered_ms: 0, ...hours[hour] })),
    ...overrides,
  };
}

export function live(overrides: Partial<EstablishmentLive> = {}): EstablishmentLive {
  return {
    enterprise_id: "park",
    occupancy: 12,
    partial_occupancy: 12,
    state: "estimated",
    contributions: [],
    missing_camera_ids: [],
    movement_available: true,
    identification_available: true,
    ...overrides,
  };
}

export function data(overrides: Partial<AssistantData> = {}): AssistantData {
  return { summary: summary(), previous: null, hourly: null, live: null, report: null, failed: false, ...overrides };
}

export function plan(intent: Plan["intent"], period: PeriodKey = "today", overrides: Partial<Plan> = {}): Plan {
  return { question: "question", intent, period, periodStated: true, granularity: null, language: "en", ...overrides };
}
