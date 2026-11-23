import { monthIndexOf } from "@/features/reports/model/reportStatuses";
import { parseIsoDate, toIsoDate, type DateRange } from "@/shared/ui-kit/lib/dateRange";
import type { IntakeReport, MapEnterprise, VisitorInsightPoint } from "@/shared/types";
import { barangayKey } from "./mapPins";
import { philippineDay } from "./time";

/*
 * Most Visited ranks enterprises, barangays or categories by visitors in the chosen range. TANAW has
 * two honest sources of visitor numbers, and each day of the range takes one of them:
 *
 *   Monthly reports  a past calendar month that lies wholly inside the range and has at least one
 *                    submitted report uses each report's unique visitor count.
 *   Camera counts    any other day in the last 30 days uses the cameras' daily unique visitor
 *                    estimate (today's from the live map, earlier days from visitor insights).
 *
 * Days that fit neither (older than 30 days and not part of a reported whole month) are left out,
 * and the subtitle says so.
 */

export type RankScope = "enterprises" | "barangays" | "categories";

export const CAMERA_HISTORY_DAYS = 30;

export type MostVisitedPlan = {
  /** Whole past months, as "YYYY-MM", counted from monthly reports. */
  reportMonths: string[];
  /** Days before today, as ISO days, counted from camera history. */
  cameraDays: string[];
  /** Whether today's live camera counts are included. */
  includesToday: boolean;
  /** Days in the range with no source. */
  uncoveredDays: number;
};

export type VisitorEntry = { enterpriseId: string; name: string; barangay: string; category: string; visitors: number };

export type RankedRow = { key: string; label: string; visitors: number; enterpriseId?: string; barangay?: string };

function addDays(iso: string, days: number) {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

export function monthKeyOfDay(iso: string) {
  return iso.slice(0, 7);
}

/** "November 2026" → "2026-11"; null when the period cannot be read. */
export function monthKeyOfPeriod(period: string) {
  const match = /^\s*([A-Za-z]+)\s+(\d{4})\s*$/.exec(period);
  if (!match) return null;
  const index = monthIndexOf(match[1]);
  return index < 0 ? null : `${match[2]}-${String(index + 1).padStart(2, "0")}`;
}

function lastDayOfMonth(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return toIsoDate(new Date(year, month, 0));
}

/** Decides which source covers each day of the range (see the note at the top of this file). */
export function planMostVisited(range: Pick<DateRange, "start" | "end">, today: Date, reportedMonths: ReadonlySet<string>): MostVisitedPlan {
  const todayIso = toIsoDate(today);
  const currentMonth = monthKeyOfDay(todayIso);
  const earliestCamera = addDays(todayIso, -(CAMERA_HISTORY_DAYS - 1));
  const last = range.end < todayIso ? range.end : todayIso;
  const reportMonths = new Set<string>();
  const cameraDays: string[] = [];
  let includesToday = false;
  let uncoveredDays = 0;

  for (let day = range.start; day <= last; day = addDays(day, 1)) {
    const month = monthKeyOfDay(day);
    const wholeMonthInRange = range.start <= `${month}-01` && range.end >= lastDayOfMonth(month);
    if (month < currentMonth && wholeMonthInRange && reportedMonths.has(month)) reportMonths.add(month);
    else if (day === todayIso) includesToday = true;
    else if (day >= earliestCamera) cameraDays.push(day);
    else uncoveredDays += 1;
  }
  return { reportMonths: [...reportMonths], cameraDays, includesToday, uncoveredDays };
}

/** The visitor-insights window that holds every camera day of the plan. */
export function cameraWindowFor(plan: MostVisitedPlan, today: Date): "7d" | "30d" | null {
  if (plan.cameraDays.length === 0) return null;
  const weekStart = addDays(toIsoDate(today), -6);
  return plan.cameraDays.every((day) => day >= weekStart) ? "7d" : "30d";
}

export function hasCameraDays(plan: MostVisitedPlan) {
  return plan.cameraDays.length > 0 || plan.includesToday;
}

/** "from monthly reports", "from camera counts", "from monthly reports and camera counts", or null with no source. */
export function mostVisitedSource(plan: MostVisitedPlan) {
  const reports = plan.reportMonths.length > 0;
  const cameras = hasCameraDays(plan);
  if (reports && cameras) return "from monthly reports and camera counts";
  if (reports) return "from monthly reports";
  if (cameras) return "from camera counts";
  return null;
}

const scopeNouns: Record<RankScope, [string, string]> = {
  enterprises: ["enterprise", "enterprises"],
  barangays: ["barangay", "barangays"],
  categories: ["category", "categories"],
};

/** "Top 5 enterprises by visitors, from camera counts" */
export function mostVisitedSubtitle(scope: RankScope, shown: number, plan: MostVisitedPlan) {
  const source = mostVisitedSource(plan);
  if (!source) return "No monthly report or camera count covers this range.";
  const [singular, plural] = scopeNouns[scope];
  const head = shown === 1 ? `Top ${singular}` : `Top ${shown} ${plural}`;
  const note = plan.uncoveredDays > 0 ? " Days older than 30 days without a monthly report are not counted." : "";
  return `${head} by visitors, ${source}.${note}`;
}

/** Sums visitors by enterprise, barangay or category and keeps the top `limit` with any visitors. */
export function rankVisitors(entries: readonly VisitorEntry[], scope: RankScope, limit = 5): RankedRow[] {
  const rows = new Map<string, RankedRow>();
  for (const entry of entries) {
    if (!(entry.visitors > 0)) continue;
    const key = scope === "enterprises" ? entry.enterpriseId : scope === "barangays" ? barangayKey(entry.barangay) : (entry.category || "Uncategorized").trim().toLowerCase();
    const label = scope === "enterprises" ? entry.name : scope === "barangays" ? entry.barangay || "Unassigned" : entry.category || "Uncategorized";
    const row = rows.get(key) ?? {
      key,
      label,
      visitors: 0,
      ...(scope === "enterprises" ? { enterpriseId: entry.enterpriseId } : {}),
      ...(scope === "barangays" ? { barangay: entry.barangay || "Unassigned" } : {}),
    };
    row.visitors += entry.visitors;
    rows.set(key, row);
  }
  return [...rows.values()].sort((left, right) => right.visitors - left.visitors || left.label.localeCompare(right.label)).slice(0, limit);
}

/** "14.2K", "980" */
export function formatCompactCount(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** The months, as "YYYY-MM", that have at least one submitted report. */
export function reportedMonths(reports: readonly Pick<IntakeReport, "period">[]) {
  const months = new Set<string>();
  for (const report of reports) {
    const month = monthKeyOfPeriod(report.period);
    if (month) months.add(month);
  }
  return months;
}

/** One entry per report and per enterprise's camera days, ready for `rankVisitors`. */
export function collectVisitorEntries(
  plan: MostVisitedPlan,
  reports: readonly IntakeReport[],
  liveEnterprises: readonly MapEnterprise[],
  cameraDaily: ReadonlyMap<string, ReadonlyMap<string, number>>,
): VisitorEntry[] {
  const months = new Set(plan.reportMonths);
  const entries: VisitorEntry[] = reports
    .filter((report) => months.has(monthKeyOfPeriod(report.period) ?? ""))
    .map((report) => ({ enterpriseId: report.enterpriseId, name: report.enterprise, barangay: report.barangay, category: report.category, visitors: report.metrics.unique ?? 0 }));
  if (!hasCameraDays(plan)) return entries;
  for (const enterprise of liveEnterprises) {
    const daily = cameraDaily.get(enterprise.id);
    let visitors = plan.cameraDays.reduce((total, day) => total + (daily?.get(day) ?? 0), 0);
    if (plan.includesToday) visitors += enterprise.estimatedUniqueCount ?? 0;
    entries.push({ enterpriseId: enterprise.id, name: enterprise.name, barangay: enterprise.barangay, category: enterprise.category, visitors });
  }
  return entries;
}

/** A visitor-insights daily series as ISO day → estimated unique visitors. */
export function dailyUniqueCounts(series: readonly VisitorInsightPoint[]) {
  const days = new Map<string, number>();
  for (const point of series) {
    if (point.estimatedUniqueCount == null) continue;
    const day = philippineDay(point.startAt);
    if (day) days.set(day, (days.get(day) ?? 0) + point.estimatedUniqueCount);
  }
  return days;
}
