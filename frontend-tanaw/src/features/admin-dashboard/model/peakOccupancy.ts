import { formatRangeText, parseIsoDate, toIsoDate, type DateRange } from "@/shared/ui-kit/lib/dateRange";
import type { VisitorInsightPoint, VisitorInsightRange } from "@/shared/types";
import type { SystemTimeFormat } from "@/shared/utils/dateTime";
import { CAMERA_HISTORY_DAYS } from "./mostVisited";
import { formatHour, formatShortDay, philippineDay } from "./time";

/*
 * Peak Occupancy charts the highest number of people inside, from camera counts. Visitor insights
 * keeps 30 days: "today" gives one point per hour, "7d" and "30d" give one point per day. The chosen
 * date range picks the smallest of those windows that reaches its first day, and the chart keeps
 * only the points inside the range.
 */

export type PeakWindow = {
  window: VisitorInsightRange;
  /** First and last ISO day shown. */
  from: string;
  to: string;
  /** True when the range starts before camera history does. */
  clipped: boolean;
};

export type PeakPoint = { key: string; label: string; value: number };

function addDays(iso: string, days: number) {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** The visitor-insights window for a range, or null when the range has no camera history. */
export function peakWindowFor(range: Pick<DateRange, "start" | "end">, today: Date): PeakWindow | null {
  const todayIso = toIsoDate(today);
  if (range.start > todayIso) return null;
  if (range.start === todayIso) return { window: "today", from: todayIso, to: todayIso, clipped: false };
  const earliest = addDays(todayIso, -(CAMERA_HISTORY_DAYS - 1));
  if (range.end < earliest) return null;
  const from = range.start > earliest ? range.start : earliest;
  const to = range.end < todayIso ? range.end : todayIso;
  return { window: from >= addDays(todayIso, -6) ? "7d" : "30d", from, to, clipped: range.start < earliest };
}

/**
 * The chart points: hourly for today, daily inside the window otherwise. Missing readings are
 * dropped, and a reply without a series (an empty or unexpected response) gives no points.
 */
export function peakPoints(series: readonly VisitorInsightPoint[] | undefined, window: PeakWindow, timeFormat: SystemTimeFormat): PeakPoint[] {
  if (!Array.isArray(series)) return [];
  return series.flatMap((point) => {
    if (point.peakVisitors == null) return [];
    if (window.window === "today") return [{ key: point.startAt, label: formatHour(point.startAt, timeFormat), value: point.peakVisitors }];
    const day = philippineDay(point.startAt);
    if (!day || day < window.from || day > window.to) return [];
    return [{ key: point.startAt, label: formatShortDay(point.startAt), value: point.peakVisitors }];
  });
}

/** The highest point; the earliest one wins a tie. */
export function highestPoint(points: readonly PeakPoint[]) {
  return points.reduce<PeakPoint | null>((best, point) => (!best || point.value > best.value ? point : best), null);
}

/** A round top for the y axis: steps of 20 up to 100, 50 up to 250, 100 up to 1,000, 200 up to 4,000, then half a power of ten. */
export function niceAxisMax(value: number) {
  if (value <= 0) return 20;
  const step = value <= 100 ? 20 : value <= 250 ? 50 : value <= 1000 ? 100 : value <= 4000 ? 200 : 5 * 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.ceil(value / step) * step;
}

/** The line under the heading, saying what the chart shows and over which days. */
export function peakSubtitle(window: PeakWindow | null) {
  if (!window) return "Camera history covers the last 30 days. Choose a range within them to see peak occupancy.";
  if (window.window === "today") return "People inside today, from live camera counts";
  if (window.from === window.to) return `Highest number inside on ${formatRangeText({ start: window.from, end: window.to })}, from camera counts`;
  const text = `Highest number inside each day, ${formatRangeText({ start: window.from, end: window.to })}`;
  return window.clipped ? `${text}. Camera history covers the last 30 days only` : text;
}

/** "at 1 PM" or "on Nov 9" */
export function peakWhen(point: PeakPoint, window: PeakWindow) {
  return `${window.window === "today" ? "at" : "on"} ${point.label}`;
}

/** "Peak 74 at 1 PM" or "Peak 210 on Nov 9" */
export function peakLabel(point: PeakPoint, window: PeakWindow) {
  return `Peak ${point.value.toLocaleString("en-US")} ${peakWhen(point, window)}`;
}
