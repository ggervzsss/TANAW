import type { DailyEstablishmentMetrics, EstablishmentHourly, EstablishmentLive, EstablishmentSummary } from "../../camera/services/establishment.types";

/** Coverage below this share of the period is mentioned in replies. */
export const LOW_COVERAGE = 0.5;

export type VisitorTotal = { kind: "unique"; value: number; partial: boolean } | { kind: "entries"; value: number } | null;
export type BusiestDay = { date: string; visitors: number | null; peak: number | null };
export type BusiestHour = { hour: number; peak: number | null; arrivals: number };
export type Change = { current: number; previous: number; difference: number; percent: number | null };
export type SexSplit = { state: "estimated"; male: number; female: number } | { state: "partial" | "unavailable" };

export type Note = { key: "partial" } | { key: "low_coverage"; percent: string } | { key: "cameras_offline" } | { key: "hourly_partial" } | { key: "hourly_unavailable" };

export function hasObservations(summary: EstablishmentSummary | null): summary is EstablishmentSummary {
  return summary != null && summary.reconciliation_state !== "not_collected";
}

function dayObserved(day: DailyEstablishmentMetrics) {
  return day.covered_ms > 0 || day.qualified_observations > 0;
}

/** Estimated unique visitors when identification ran, otherwise doorway entries, otherwise nothing. */
export function visitorTotal(summary: EstablishmentSummary): VisitorTotal {
  if (summary.identification_state !== "unavailable") return { kind: "unique", value: summary.unique_count, partial: summary.identification_state === "partial" };
  if (summary.movement_state !== "unavailable") return { kind: "entries", value: summary.entries };
  return null;
}

/** The observed day with the most estimated visitors, or the highest occupancy when visitors were not identified. */
export function busiestDay(summary: EstablishmentSummary): BusiestDay | null {
  const days = summary.days.filter(dayObserved);
  const identified = days.filter((day) => day.identification_state !== "unavailable");
  if (identified.some((day) => day.unique_count > 0)) {
    const best = identified.reduce((top, day) => (day.unique_count > top.unique_count ? day : top));
    return { date: best.business_date, visitors: best.unique_count, peak: best.peak_occupancy };
  }
  const peaked = days.filter((day) => day.peak_occupancy != null && day.peak_occupancy > 0);
  if (!peaked.length) return null;
  const best = peaked.reduce((top, day) => (day.peak_occupancy! > top.peak_occupancy! ? day : top));
  return { date: best.business_date, visitors: null, peak: best.peak_occupancy };
}

/** The hour with the highest occupancy; arrivals break ties and stand in when occupancy was not recorded. */
export function busiestHour(hourly: EstablishmentHourly | null): BusiestHour | null {
  if (!hourly || hourly.state === "unavailable") return null;
  const hours = hourly.hours.map((hour) => ({ hour: hour.hour, peak: hour.peak_occupancy, arrivals: hour.entries + hour.area_visits }));
  const rank = (item: BusiestHour) => [item.peak ?? -1, item.arrivals] as const;
  const best = hours.reduce<BusiestHour | null>((top, item) => {
    if (!top) return item;
    const [peak, arrivals] = rank(item);
    const [topPeak, topArrivals] = rank(top);
    return peak > topPeak || (peak === topPeak && arrivals > topArrivals) ? item : top;
  }, null);
  if (!best || ((best.peak ?? 0) <= 0 && best.arrivals <= 0)) return null;
  return best;
}

/** Change in estimated unique visitors against the previous period, when both were identified. */
export function visitorChange(current: EstablishmentSummary, previous: EstablishmentSummary | null): Change | null {
  if (!previous || current.identification_state === "unavailable" || previous.identification_state === "unavailable" || !hasObservations(previous)) return null;
  const difference = current.unique_count - previous.unique_count;
  return {
    current: current.unique_count,
    previous: previous.unique_count,
    difference,
    percent: previous.unique_count > 0 ? Math.round((difference / previous.unique_count) * 100) : null,
  };
}

export function sexSplit(summary: EstablishmentSummary): SexSplit {
  if (summary.sex_estimation_state === "estimated" && summary.male_count != null && summary.female_count != null) {
    return { state: "estimated", male: summary.male_count, female: summary.female_count };
  }
  return { state: summary.sex_estimation_state === "partial" ? "partial" : "unavailable" };
}

/** Coverage as the dashboard shows it: "<1" for tiny shares, otherwise a whole percent. */
export function coveragePercent(ratio: number): string {
  return ratio > 0 && ratio < 0.01 ? "<1" : String(Math.round(ratio * 100));
}

/**
 * Share of the period's elapsed time that cameras observed. A period that includes
 * today is measured up to ``now``, so a morning answer is not called low coverage.
 */
export function elapsedCoverage(summary: EstablishmentSummary, now: Date): number {
  const start = Date.parse(summary.from_at);
  const elapsed = Math.min(now.getTime(), Date.parse(summary.to_at)) - start;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return summary.coverage_ratio;
  return Math.min(1, summary.covered_ms / elapsed);
}

/** Caveats that apply to an answer about ``summary``. */
export function summaryNotes(summary: EstablishmentSummary | null, live: EstablishmentLive | null, now: Date): Note[] {
  const notes: Note[] = [];
  if (summary && hasObservations(summary)) {
    if (summary.reconciliation_state === "partial") notes.push({ key: "partial" });
    const coverage = elapsedCoverage(summary, now);
    if (coverage < LOW_COVERAGE) notes.push({ key: "low_coverage", percent: coveragePercent(coverage) });
  }
  if (live && (live.state === "partial" || (live.missing_camera_ids?.length ?? 0) > 0)) notes.push({ key: "cameras_offline" });
  return notes;
}

export function hourlyNotes(hourly: EstablishmentHourly | null): Note[] {
  if (!hourly || hourly.state === "unavailable") return [{ key: "hourly_unavailable" }];
  return hourly.state === "partial" ? [{ key: "hourly_partial" }] : [];
}
