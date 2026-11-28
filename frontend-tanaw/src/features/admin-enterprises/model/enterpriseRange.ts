import type { ApiVisitorRanking } from "@/contracts/api";
import { formatRangeText, isValidDateRange, parseIsoDate, presetRange, rangeDayCount, toIsoDate, type DateRange } from "@/shared/ui-kit/lib/dateRange";
import type { TrendPeriod } from "./enterpriseTrend";

/*
 * The date range on Enterprise Details. Today is the default; any other range is kept in the
 * address as ?range=<preset>&from=YYYY-MM-DD&to=YYYY-MM-DD so a link reopens the same days.
 *
 * Two sources answer a range, as on the Admin Dashboard:
 *
 *   Camera counts    /operational/visitor-insights?start&end: one day by hour, longer ranges by day.
 *                    The server keeps CAMERA_HISTORY_DAYS of them, so a range is clipped to that
 *                    window and the page says so.
 *   Visitor totals   /operational/visitor-insights/ranking: whole past months from monthly reports,
 *                    other days in the camera history from camera counts.
 *
 * Cameras, live occupancy and camera status are always "now", whatever the range.
 */

/** Days of camera counts the server keeps, today included. Matches the server's window. */
export const CAMERA_HISTORY_DAYS = 30;

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function addDays(iso: string, days: number) {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

/** True when the range is exactly today, the live view. */
export function isLiveRange(range: Pick<DateRange, "start" | "end">, today: Date) {
  const todayIso = toIsoDate(today);
  return range.start === todayIso && range.end === todayIso;
}

/** The range in the address, or today when it is missing, malformed or in the future. */
export function rangeFromParams(params: URLSearchParams, today: Date): DateRange {
  const preset = params.get("range");
  const candidate = { preset, start: params.get("from"), end: params.get("to") };
  if (preset && preset !== "today" && isValidDateRange(candidate) && candidate.end <= toIsoDate(today)) return candidate;
  return presetRange("today", today);
}

/** The address with the range written in (or removed for today), other parameters kept. */
export function paramsWithRange(params: URLSearchParams, range: DateRange, today: Date) {
  const next = new URLSearchParams(params);
  next.delete("range");
  next.delete("from");
  next.delete("to");
  if (range.preset === "today" && isLiveRange(range, today)) return next;
  next.set("range", range.preset);
  next.set("from", range.start);
  next.set("to", range.end);
  return next;
}

/** "Nov 3", with the year when it is not this year. */
function dayText(iso: string, today: Date) {
  const date = parseIsoDate(iso);
  const text = `${MONTHS[date.getMonth()].slice(0, 3)} ${date.getDate()}`;
  return date.getFullYear() === today.getFullYear() ? text : `${text}, ${date.getFullYear()}`;
}

/**
 * The range in words, to finish a label: "today", "on Nov 3", "in the last 7 days",
 * "in October 2026", "in November 2026 so far", "in 2026 so far", "from Nov 1 to Nov 20".
 */
export function rangePhrase(range: DateRange, today: Date) {
  const todayIso = toIsoDate(today);
  if (isLiveRange(range, today)) return "today";
  if (range.start === range.end) return `on ${dayText(range.start, today)}`;
  const soFar = range.end === todayIso ? " so far" : "";
  if (range.preset === "last7" && range.end === todayIso && range.start === addDays(todayIso, -6)) return "in the last 7 days";
  const start = parseIsoDate(range.start);
  if (range.preset === "month") return `in ${MONTHS[start.getMonth()]} ${start.getFullYear()}${soFar}`;
  if (range.preset === "year") return `in ${start.getFullYear()}${soFar}`;
  return `from ${dayText(range.start, today)} to ${dayText(range.end, today)}`;
}

export type CameraWindow = {
  /** First and last ISO day with camera history inside the range. */
  from: string;
  to: string;
  /** True when the range starts before the camera history does. */
  clipped: boolean;
};

/** The part of the range the camera history covers, or null when it covers none of it. */
export function cameraWindow(range: Pick<DateRange, "start" | "end">, today: Date): CameraWindow | null {
  const todayIso = toIsoDate(today);
  const earliest = addDays(todayIso, -(CAMERA_HISTORY_DAYS - 1));
  const from = range.start > earliest ? range.start : earliest;
  const to = range.end < todayIso ? range.end : todayIso;
  if (from > to) return null;
  return { from, to, clipped: range.start < earliest };
}

/** "Camera history covers the last 30 days only." */
export const CAMERA_HISTORY_NOTE = `Camera history covers the last ${CAMERA_HISTORY_DAYS} days only`;

/** The trend periods that fit a range: by hour for one day; by day or by monthly report for longer ones. */
export function trendPeriodsFor(range: Pick<DateRange, "start" | "end">): TrendPeriod[] {
  return range.start === range.end ? ["hourly"] : ["daily", "monthly"];
}

/** The period shown by default: hourly for one day, monthly when camera history covers less than half the range. */
export function defaultTrendPeriod(range: Pick<DateRange, "start" | "end">, today: Date): TrendPeriod {
  if (range.start === range.end) return "hourly";
  const window = cameraWindow(range, today);
  if (!window) return "monthly";
  return rangeDayCount({ start: window.from, end: window.to }) * 2 >= rangeDayCount(range) ? "daily" : "monthly";
}

/** The requested period (?trend=) when it fits the range, otherwise the range's default. */
export function trendPeriodFor(requested: string | null, range: Pick<DateRange, "start" | "end">, today: Date): TrendPeriod {
  const fits = trendPeriodsFor(range).find((period) => period === requested);
  return fits ?? defaultTrendPeriod(range, today);
}

/** Where the visitor total of a range came from, as the ranking reports it. */
function totalSource(ranking: Pick<ApiVisitorRanking, "reportMonths" | "cameraDays">) {
  const reports = ranking.reportMonths.length;
  const cameras = ranking.cameraDays > 0;
  if (reports > 0 && cameras) return "From monthly reports and camera counts";
  if (reports > 1) return "From monthly reports";
  if (reports === 1) return "From the monthly report";
  if (cameras) return "From camera counts";
  return null;
}

export type RangeVisitors = { value: number | null; note: string };

/** This enterprise's visitors in the range, from the ranking, with a note saying where they came from. */
export function rangeVisitors(ranking: ApiVisitorRanking, enterpriseId: string): RangeVisitors {
  const source = totalSource(ranking);
  if (!source) return { value: null, note: "No monthly report or camera count covers this range" };
  const entry = ranking.enterprises.find((item) => item.enterpriseId === enterpriseId);
  if (!entry || !(entry.visitors > 0)) return { value: null, note: "No visitors counted for this enterprise in this range" };
  const uncovered = ranking.uncoveredDays > 0 ? `. Days older than ${CAMERA_HISTORY_DAYS} days without a monthly report are not counted` : "";
  return { value: entry.visitors, note: `${source}${uncovered}` };
}

/** "Oct 27 – Nov 25, 2026", for a clipped window. */
export function windowText(window: CameraWindow) {
  return formatRangeText({ start: window.from, end: window.to });
}

/** The trend heading when there is no chart to build it from. */
export function trendTitle(period: TrendPeriod, range: DateRange, today: Date) {
  if (period === "daily") return "Daily Trend";
  if (period === "monthly") return "Monthly Trend";
  return isLiveRange(range, today) ? "Today’s Trend" : `Trend ${rangePhrase(range, today)}`;
}

/** The line under the trend heading: what one bar measures, over which days. */
export function trendSource(period: TrendPeriod, range: DateRange, today: Date) {
  const phrase = rangePhrase(range, today);
  if (period === "hourly") return `Most visitors inside at once in each hour ${phrase}.`;
  if (period === "monthly") return `Visitors stated in each submitted monthly report ${phrase}.`;
  const window = cameraWindow(range, today);
  if (window?.clipped) return `Visitors on each day, ${windowText(window)}. ${CAMERA_HISTORY_NOTE}.`;
  return `Visitors on each day ${phrase}.`;
}

/** What the chart says when it has no bars. */
export function emptyTrendMessage(period: TrendPeriod, range: DateRange, today: Date) {
  if (period === "monthly") return "No monthly report has been submitted for these months.";
  const phrase = rangePhrase(range, today);
  if (!cameraWindow(range, today)) {
    return `Camera history covers the last ${CAMERA_HISTORY_DAYS} days, so there are no camera counts ${phrase}. Monthly reports cover older months.`;
  }
  if (period === "hourly") return isLiveRange(range, today) ? "No camera counts have arrived today yet." : `No camera counts were recorded ${phrase}.`;
  return `No daily counts ${phrase}.`;
}
