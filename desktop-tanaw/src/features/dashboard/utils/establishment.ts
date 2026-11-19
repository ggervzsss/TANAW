import type { DailyOrigins, DemoBreakdown, Metrics } from "../../../types/enterprise";
import { DAY_MS, philippineDayStart, type SystemTimeFormat } from "../../../utils/date-time";
import type { EstablishmentHourly, EstablishmentSummary } from "../../camera/services/establishment.types";
import { monthlyDemoFromDays, reportDays } from "../../reports/model/daily-origins";
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

/** "2 PM" or, in 24-hour format, "14:00". */
export function formatHourLabel(hour: number, timeFormat: SystemTimeFormat) {
  if (timeFormat === "24-hour") return `${String(hour).padStart(2, "0")}:00`;
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "AM" : "PM"}`;
}

/** Highest occupancy in each hour, from the first to the last observed hour; unobserved hours stay gaps. */
export function hourlyOccupancyTrend(hourly: EstablishmentHourly | null, timeFormat: SystemTimeFormat) {
  const observed = (hourly?.hours ?? []).filter((hour) => hour.covered_ms > 0 || hour.peak_occupancy !== null);
  if (!hourly || hourly.state === "unavailable" || !observed.length) return [];
  const first = Math.min(...observed.map((hour) => hour.hour));
  const last = Math.max(...observed.map((hour) => hour.hour));
  return hourly.hours.filter((hour) => hour.hour >= first && hour.hour <= last).map((hour) => ({ label: formatHourLabel(hour.hour, timeFormat), occupancy: hour.peak_occupancy }));
}

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  return `${new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", { month: "long", timeZone: "UTC" })} ${year}`;
}

/** The reporting months ("November 2026") that a dashboard range covers. */
export function rangeMonths(range: { start: string; end: string }) {
  const months = new Set<string>();
  for (let at = Date.parse(range.start); at < Date.parse(range.end); at += DAY_MS) months.add(new Date(at + 8 * 60 * 60 * 1000).toISOString().slice(0, 7));
  return [...months].map(monthLabel);
}

/**
 * Residence and sex of the period's counted visitors. TANAW counts every visitor as This City with
 * its male/female estimate; visitors the establishment confirmed as from other origins are moved out.
 */
export function periodDemographics(summary: EstablishmentSummary | null, origins: DailyOrigins): { demo: DemoBreakdown; unconfirmedDays: number } | null {
  if (!summary) return null;
  const dates = new Set(summary.days.map((day) => day.business_date));
  const metrics: Metrics = { entries: null, exits: null, peak: null, unique: summary.unique_count, counting: summary };
  const months = [...new Set(summary.days.map((day) => day.business_date.slice(0, 7)))].map(monthLabel);
  const days = months.flatMap((period) => reportDays(period, metrics, origins)).filter((day) => dates.has(day.date));
  return { demo: monthlyDemoFromDays(days), unconfirmedDays: days.filter((day) => day.unique && !day.origins).length };
}
