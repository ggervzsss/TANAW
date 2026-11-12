import type { EstablishmentSummary } from "../../camera/services/establishment.types";
import type { TrendFilter } from "../types/dashboard";

export function establishmentRange(filter: TrendFilter, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => Number(parts.find((item) => item.type === name)?.value);
  const today = Date.UTC(part("year"), part("month") - 1, part("day")) - 8 * 60 * 60 * 1000;
  const days = filter === "Today" ? 1 : filter === "Week" ? 7 : 30;
  return { start: new Date(today - (days - 1) * 86_400_000).toISOString(), end: new Date(today + 86_400_000).toISOString() };
}

export function establishmentTrend(summary: EstablishmentSummary | null, range: { start: string; end: string }) {
  const byDate = new Map(summary?.days.map((day) => [day.business_date, day]) ?? []);
  const points = [];
  for (let at = Date.parse(range.start); at < Date.parse(range.end); at += 86_400_000) {
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
