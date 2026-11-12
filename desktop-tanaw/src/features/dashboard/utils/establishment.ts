import { DAY_MS, philippineDayStart } from "../../../utils/date-time";
import type { EstablishmentSummary } from "../../camera/services/establishment.types";
import type { TrendFilter } from "../types/dashboard";

export function establishmentRange(filter: TrendFilter, now = new Date()) {
  const today = philippineDayStart(now);
  const days = filter === "Today" ? 1 : filter === "Week" ? 7 : 30;
  return { start: new Date(today - (days - 1) * DAY_MS).toISOString(), end: new Date(today + DAY_MS).toISOString() };
}

export function establishmentTrend(summary: EstablishmentSummary | null, range: { start: string; end: string }) {
  const byDate = new Map(summary?.days.map((day) => [day.business_date, day]) ?? []);
  const points = [];
  for (let at = Date.parse(range.start); at < Date.parse(range.end); at += DAY_MS) {
    const date = new Date(at);
    const key = new Date(at + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const day = byDate.get(key);
    const observed = day && (day.covered_ms > 0 || day.qualified_observations > 0);
    points.push({
      date: key,
      label: date.toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric" }),
      visitors: observed && day.identification_state !== "unavailable" ? day.unique_count : null,
      occupancy: observed ? day.peak_occupancy : null,
    });
  }
  return points;
}
