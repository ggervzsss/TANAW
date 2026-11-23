import type { ApiVisitorRanking } from "@/contracts/api";
import { barangayKey } from "./mapPins";

/*
 * Most Visited ranks enterprises, barangays or categories by visitors in the chosen range. The
 * server (`/operational/visitor-insights/ranking`) works out each enterprise's visitors in one
 * request, taking each day of the range from one of two honest sources:
 *
 *   Monthly reports  a past calendar month that lies wholly inside the range and has at least one
 *                    submitted report uses each report's unique visitor count.
 *   Camera counts    any other day in the last 30 days uses the cameras' daily unique visitor
 *                    estimate.
 *
 * Days that fit neither (older than 30 days and not part of a reported whole month) are left out,
 * and the subtitle says so. This file only words that result and groups it for the chosen scope.
 */

export type RankScope = "enterprises" | "barangays" | "categories";

/** How far back camera history goes, shared with Peak Occupancy. Matches the server's window. */
export const CAMERA_HISTORY_DAYS = 30;

export type VisitorRankingSources = Pick<ApiVisitorRanking, "reportMonths" | "cameraDays" | "uncoveredDays">;
export type VisitorEntry = ApiVisitorRanking["enterprises"][number];

export type RankedRow = { key: string; label: string; visitors: number; enterpriseId?: string; barangay?: string };

/** "from monthly reports", "from camera counts", "from monthly reports and camera counts", or null with no source. */
export function mostVisitedSource(sources: VisitorRankingSources) {
  const reports = sources.reportMonths.length > 0;
  const cameras = sources.cameraDays > 0;
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

/** "Top 5 enterprises by visitors, from camera counts." */
export function mostVisitedSubtitle(scope: RankScope, shown: number, sources: VisitorRankingSources) {
  const source = mostVisitedSource(sources);
  if (!source) return "No monthly report or camera count covers this range.";
  const [singular, plural] = scopeNouns[scope];
  const head = shown === 1 ? `Top ${singular}` : `Top ${shown} ${plural}`;
  const note = sources.uncoveredDays > 0 ? " Days older than 30 days without a monthly report are not counted." : "";
  return `${head} by visitors, ${source}.${note}`;
}

/** Sums visitors by enterprise, barangay or category and keeps the top `limit` with any visitors. */
export function rankVisitors(entries: readonly VisitorEntry[], scope: RankScope, limit = 5): RankedRow[] {
  const rows = new Map<string, RankedRow>();
  for (const entry of entries) {
    if (!(entry.visitors > 0)) continue;
    const key = scope === "enterprises" ? entry.enterpriseId : scope === "barangays" ? barangayKey(entry.barangay) : (entry.category || "Uncategorized").trim().toLowerCase();
    const label = scope === "enterprises" ? entry.enterpriseName : scope === "barangays" ? entry.barangay || "Unassigned" : entry.category || "Uncategorized";
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
