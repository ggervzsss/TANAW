import { alertTone } from "@/features/live-alerts/model/liveAlerts";
import type { LiveAlert } from "@/shared/types";
import type { ActivityFilters } from "./recentActivity";

/*
 * Busiest Enterprises: every place that is busier than usual right now gets one row pinned above
 * the Recent Activity records. The rows come from the live alerts (the query behind the topbar
 * alert icon), and a busy alert ends by itself when the place is back to usual, so a pinned row
 * stays exactly as long as its place is busy. Pinned rows are not records: they are not counted
 * or paged, and selecting one opens the place on the Dashboard map rather than the drawer.
 */

/** The chip that names the category on a pinned row. */
export const BUSY_CATEGORY_LABEL = "Busiest enterprises";

function startedAtValue(alert: LiveAlert) {
  const value = Date.parse(alert.startedAt);
  return Number.isNaN(value) ? 0 : value;
}

/** Critical (twice the usual or more) first, then the most recently busy, as the list reads newest first. */
function compareBusy(left: LiveAlert, right: LiveAlert) {
  return Number(right.severity === "Critical") - Number(left.severity === "Critical") || startedAtValue(right) - startedAtValue(left) || left.id.localeCompare(right.id);
}

/** The places busier than usual right now: one active busy alert per place. */
export function busyEnterpriseAlerts(alerts: readonly LiveAlert[]): LiveAlert[] {
  const seen = new Set<string>();
  return alerts
    .filter((alert) => alertTone(alert) === "busy" && alert.status === "Active" && !alert.endedAt)
    .sort(compareBusy)
    .filter((alert) => {
      const place = alert.enterpriseId ?? alert.enterpriseName ?? alert.id;
      if (seen.has(place)) return false;
      seen.add(place);
      return true;
    });
}

/**
 * The busy places to pin for the current filters. They are "now", so they show only when the
 * range includes `today` (the Philippine day, `YYYY-MM-DD`), under All Activity or Busiest
 * Enterprises, and, with a search, only when the enterprise name matches it.
 */
export function pinnedBusyAlerts(alerts: readonly LiveAlert[], filters: ActivityFilters, today: string): LiveAlert[] {
  if (filters.type !== "all" && filters.type !== "busy") return [];
  if (!rangeIncludes(filters.range, today)) return [];
  const query = filters.query.trim().toLowerCase();
  return busyEnterpriseAlerts(alerts).filter((alert) => !query || (alert.enterpriseName ?? "").toLowerCase().includes(query));
}

export function rangeIncludes(range: ActivityFilters["range"], day: string) {
  return Boolean(day) && range.start <= day && day <= range.end;
}

/** "2 busy enterprises pinned" for the summary line, or null when none is pinned. */
export function busyPinnedLabel(count: number) {
  if (count <= 0) return null;
  return `${count} busy ${count === 1 ? "enterprise" : "enterprises"} pinned`;
}

/** The pinned rows show on the first page only, above that page's records. */
export function pinnedForPage(pinned: readonly LiveAlert[], page: number): readonly LiveAlert[] {
  return page === 1 ? pinned : [];
}
