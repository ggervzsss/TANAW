/**
 * Made-up dashboard data for Settings > Developer > Sample dashboard data. It lets people check the
 * full Dashboard layout before real counts build up. None of it is saved, sent or reported.
 */
import type { Camera, ReportRecord } from "../../../types/enterprise";
import type { DailyEstablishmentMetrics, EstablishmentHourly, EstablishmentLive, EstablishmentSummary } from "../../camera/services/establishment.types";
import type { DashboardRange } from "../types/dashboard";
import type { CameraStatusMarks } from "../utils/camera-status";
import { addDays, dayStartMs, rangeBounds, rangeDates, rangeLength, weekday } from "../utils/dashboard-range";
import { usualHistoryDates, USUAL_WEEKS } from "../utils/traffic";

const HOUR_MS = 3_600_000;
const SAMPLE_ENTERPRISE = "sample";
/** A typical day by weekday, Sunday first. */
const DAY_TOTALS = [4800, 3870, 3600, 3650, 3750, 4300, 5200];
/** Share of a day's entries in each hour from 8 AM to 7 PM. */
const HOUR_SHARE = [0.026, 0.032, 0.041, 0.051, 0.057, 0.068, 0.07, 0.084, 0.087, 0.097, 0.118, 0.097, 0.09, 0.081].slice(0, 12);
const FIRST_HOUR = 8;
const SHARE_TOTAL = HOUR_SHARE.reduce((sum, share) => sum + share, 0);

/** A steady pseudo-random number in [0, 1) for a date, so the sample doesn't jump on every refresh. */
function seeded(key: string) {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 10_000) / 10_000;
}

function dayTotal(date: string, today: string) {
  const base = DAY_TOTALS[weekday(date)] * (0.86 + 0.28 * seeded(date));
  // Today runs a little busier than usual so the chart shows both colours.
  return Math.round(date === today ? base * 1.12 : base);
}

/** Entries per hour of a date; today stops at the current time. */
function hoursOf(date: string, today: string, elapsedHours: number) {
  const total = dayTotal(date, today);
  return Array.from({ length: 24 }, (_, hour) => {
    const index = hour - FIRST_HOUR;
    const open = index >= 0 && index < HOUR_SHARE.length;
    const share = open ? HOUR_SHARE[index] / SHARE_TOTAL : 0;
    const done = date !== today ? 1 : Math.max(0, Math.min(1, elapsedHours - hour));
    const entries = open ? Math.round(total * share * (0.9 + 0.2 * seeded(`${date}:${hour}`)) * done) : 0;
    return { hour, entries, area_visits: 0, peak_occupancy: open && done > 0 ? Math.round(entries * 0.35) : null, covered_ms: open && done > 0 ? Math.round(HOUR_MS * done) : 0 };
  });
}

function dayMetrics(date: string, today: string, elapsedHours: number): DailyEstablishmentMetrics {
  const hours = hoursOf(date, today, elapsedHours);
  const entries = hours.reduce((sum, hour) => sum + hour.entries, 0);
  const covered = hours.reduce((sum, hour) => sum + hour.covered_ms, 0);
  // About one entry in six is someone coming back in, as at a busy heritage site.
  const unique = Math.round(entries * 0.82);
  return {
    business_date: date,
    unique_count: unique,
    confirmed_unique_count: unique,
    entries,
    exits: Math.round(entries * 0.97),
    repeat_entry_count: entries - unique,
    unresolved_observations: 0,
    qualified_observations: entries,
    identification_coverage: 1,
    identification_state: "available",
    reconciliation_state: "estimated",
    movement_state: "available",
    peak_occupancy: Math.max(0, ...hours.map((hour) => hour.peak_occupancy ?? 0)),
    covered_ms: covered,
    coverage_ratio: 1,
    counting_basis: "sum_of_daily_establishment_unique_visitors",
    policy_version: 1,
    finalized: date !== today,
    first_event_at: null,
    last_event_at: null,
    sources: [1, 2],
    incompatible_identity_models: false,
  };
}

function summaryOf(range: Pick<DashboardRange, "from" | "to">, today: string, elapsedHours: number): EstablishmentSummary {
  const days = rangeDates(range)
    .filter((date) => date <= today)
    .map((date) => dayMetrics(date, today, elapsedHours));
  const sum = (key: "entries" | "exits" | "unique_count" | "repeat_entry_count") => days.reduce((total, day) => total + day[key], 0);
  const bounds = rangeBounds(range);
  return {
    enterprise_id: SAMPLE_ENTERPRISE,
    from_at: bounds.start,
    to_at: bounds.end,
    timezone: "Asia/Manila",
    days,
    days_available: days.length,
    days_requested: rangeLength(range),
    snapshot_version: "sample",
    unique_count: sum("unique_count"),
    confirmed_unique_count: sum("unique_count"),
    entries: sum("entries"),
    exits: sum("exits"),
    repeat_entry_count: sum("repeat_entry_count"),
    unresolved_observations: 0,
    qualified_observations: sum("entries"),
    peak_occupancy: Math.max(0, ...days.map((day) => day.peak_occupancy ?? 0)),
    covered_ms: days.reduce((total, day) => total + day.covered_ms, 0),
    coverage_ratio: 1,
    counting_basis: "sum_of_daily_establishment_unique_visitors",
    policy_version: 1,
    reconciliation_state: "estimated",
    movement_state: "available",
    identification_state: "available",
    source_breakdown: [],
  };
}

function hourlyOf(date: string, today: string, elapsedHours: number): EstablishmentHourly {
  const bounds = rangeBounds({ from: date, to: date });
  return { enterprise_id: SAMPLE_ENTERPRISE, from_at: bounds.start, to_at: bounds.end, timezone: "Asia/Manila", days_requested: 1, days_retained: 1, state: "available", hours: hoursOf(date, today, elapsedHours) };
}

export const SAMPLE_CAMERAS = [
  { id: 9001, name: "Main Entrance", analysisMode: "entrance_exit" },
  { id: 9002, name: "Side Entrance", analysisMode: "entrance_exit" },
  { id: 9003, name: "Parking Area", analysisMode: "entrance_exit" },
  { id: 9004, name: "Garden Walk", analysisMode: "open_space" },
  { id: 9005, name: "Exit Gate", analysisMode: "entrance_exit" },
] as Camera[];

const SAMPLE_LIVE: EstablishmentLive = {
  enterprise_id: SAMPLE_ENTERPRISE,
  occupancy: 60,
  partial_occupancy: 60,
  state: "partial",
  contributions: [
    { camera_ids: [9001, 9002, 9005], occupancy: 48, state: "estimated", basis: "entry_exit_balance" },
    { camera_ids: [9004], occupancy: 12, state: "estimated", basis: "observed_presence" },
  ],
  missing_camera_ids: [9003],
  movement_available: true,
  identification_available: true,
};

const report = (id: string, period: string, date: string, status: string, entries: number, syncStatus = "submitted"): ReportRecord => ({
  id,
  period,
  date,
  status,
  entries,
  exits: Math.round(entries * 0.987),
  peak: Math.round(entries / 290),
  unique: Math.round(entries * 0.82),
  syncStatus,
});

const SAMPLE_REPORTS: ReportRecord[] = [
  report("SAMPLE-2026-10", "October 2026", "Nov 7, 2026", "Submitted", 118_402),
  report("SAMPLE-2026-09", "September 2026", "Oct 6, 2026", "Submitted", 109_877),
  report("SAMPLE-2026-08", "August 2026", "Sep 5, 2026", "Returned for Revision", 121_560),
  report("SAMPLE-2026-07", "July 2026", "Aug 6, 2026", "Submitted", 131_204),
  report("SAMPLE-2026-06", "June 2026", "Jul 7, 2026", "Submitted", 126_998),
  report("SAMPLE-2026-05", "May 2026", "Jun 5, 2026", "Submitted", 140_311, "pending"),
  report("SAMPLE-2026-04", "April 2026", "May 7, 2026", "Submitted", 137_450),
];

/** When each sample camera started counting today, and when Parking Area stopped. */
function sampleMarks(today: string, elapsedHours: number): CameraStatusMarks {
  const at = (hours: number) => dayStartMs(today) + Math.min(hours, Math.max(0, elapsedHours - 0.25)) * 3_600_000;
  return {
    "9001": { counting: true, since: at(7 + 2 / 60) },
    "9002": { counting: true, since: at(7 + 4 / 60) },
    "9003": { counting: false, since: at(15 + 10 / 60) },
    "9004": { counting: true, since: at(7 + 30 / 60) },
    "9005": { counting: true, since: at(7 + 5 / 60) },
  };
}

/** Everything the Dashboard reads, made up for one range at one moment. */
export function sampleDashboard(range: DashboardRange, today: string, elapsedHours: number) {
  const single = range.from === range.to;
  const span = Math.max(USUAL_WEEKS * 7, rangeLength(range));
  return {
    cameras: SAMPLE_CAMERAS,
    live: SAMPLE_LIVE,
    marks: sampleMarks(today, elapsedHours),
    summary: summaryOf(range, today, elapsedHours),
    hourly: single ? hourlyOf(range.from, today, elapsedHours) : null,
    usualHours: single ? usualHistoryDates(range.from).map((date) => hourlyOf(date, today, elapsedHours)) : [],
    usualDays: single ? null : summaryOf({ from: addDays(range.from, -span), to: addDays(range.from, -1) }, today, elapsedHours),
    reports: SAMPLE_REPORTS,
  };
}
