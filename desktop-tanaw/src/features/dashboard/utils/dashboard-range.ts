import { DAY_MS, philippineDayStart } from "../../../utils/date-time";
import type { DashboardPreset, DashboardRange, TrendFilter } from "../types/dashboard";

/** Longest range the dashboard asks for; the local service keeps hourly detail for about a month. */
export const MAX_RANGE_DAYS = 31;
/** How far back the calendar reaches. */
export const CALENDAR_HISTORY_DAYS = 366;

const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Today's business date in Manila, e.g. "2026-11-16". */
export function businessDate(now = new Date()) {
  return new Date(philippineDayStart(now) + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** Midnight in Manila at the start of a business date, as epoch milliseconds. */
export function dayStartMs(date: string) {
  return Date.parse(`${date}T00:00:00+08:00`);
}

export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function rangeLength(range: Pick<DashboardRange, "from" | "to">) {
  return daysBetween(range.from, range.to) + 1;
}

export function rangeDates(range: Pick<DashboardRange, "from" | "to">) {
  return Array.from({ length: rangeLength(range) }, (_, index) => addDays(range.from, index));
}

export function weekday(date: string) {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function weekdayName(date: string) {
  return WEEKDAYS[weekday(date)];
}

/** "Nov 14" */
export function shortDate(date: string) {
  const at = new Date(`${date}T00:00:00Z`);
  return `${MONTHS[at.getUTCMonth()].slice(0, 3)} ${at.getUTCDate()}`;
}

/** "November 14, 2026" */
export function longDate(date: string) {
  const at = new Date(`${date}T00:00:00Z`);
  return `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()}, ${at.getUTCFullYear()}`;
}

export function presetRange(preset: Exclude<DashboardPreset, "custom">, today: string): DashboardRange {
  switch (preset) {
    case "today":
      return { from: today, to: today, preset };
    case "yesterday": {
      const day = addDays(today, -1);
      return { from: day, to: day, preset };
    }
    case "week":
      return { from: addDays(today, -6), to: today, preset };
    case "month":
      return { from: addDays(today, -29), to: today, preset };
    case "thisMonth":
      return { from: `${today.slice(0, 8)}01`, to: today, preset };
  }
}

export const RANGE_PRESETS: Array<{ id: Exclude<DashboardPreset, "custom">; label: string }> = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "Last 7 days" },
  { id: "month", label: "Last 30 days" },
  { id: "thisMonth", label: "This month" },
];

/** Start and end instants for the local service: Manila midnight to the midnight after `to`. */
export function rangeBounds(range: Pick<DashboardRange, "from" | "to">) {
  return { start: new Date(dayStartMs(range.from)).toISOString(), end: new Date(dayStartMs(range.to) + DAY_MS).toISOString() };
}

export function isSingleDay(range: Pick<DashboardRange, "from" | "to">) {
  return range.from === range.to;
}

/** "Today, November 16, 2026", "Saturday, November 14, 2026" or "Nov 10 to 16, 2026". */
export function rangeLabel(range: Pick<DashboardRange, "from" | "to">, today: string) {
  if (isSingleDay(range)) {
    const prefix = range.from === today ? "Today" : range.from === addDays(today, -1) ? "Yesterday" : weekdayName(range.from);
    return `${prefix}, ${longDate(range.from)}`;
  }
  const sameMonth = range.from.slice(0, 7) === range.to.slice(0, 7);
  const end = sameMonth ? String(Number(range.to.slice(8, 10))) : shortDate(range.to);
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  return sameYear ? `${shortDate(range.from)} to ${end}, ${range.to.slice(0, 4)}` : `${shortDate(range.from)}, ${range.from.slice(0, 4)} to ${end}, ${range.to.slice(0, 4)}`;
}

/** How a sentence names the range: "today", "yesterday", "on Nov 14" or "from Nov 10 to Nov 16". */
export function rangePhrase(range: Pick<DashboardRange, "from" | "to">, today: string) {
  if (isSingleDay(range)) return range.from === today ? "today" : range.from === addDays(today, -1) ? "yesterday" : `on ${shortDate(range.from)}`;
  return `from ${shortDate(range.from)} to ${shortDate(range.to)}`;
}

/** The period TANAW Insights should assume for questions asked while this range is showing. */
export function assistantFilter(range: Pick<DashboardRange, "from" | "to">): TrendFilter {
  const days = rangeLength(range);
  return days <= 1 ? "Today" : days <= 7 ? "Week" : "Month";
}

/** Weeks of a month for the calendar, Sunday first; days outside the month are null. */
export function monthGrid(year: number, month: number): Array<Array<string | null>> {
  const first = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<string | null> = Array.from({ length: first.getUTCDay() }, () => null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10));
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
}

export function monthTitle(year: number, month: number) {
  return `${MONTHS[month]} ${year}`;
}

/** A finished draft range: ordered, and no longer than MAX_RANGE_DAYS. */
export function normalizeRange(a: string, b: string): Pick<DashboardRange, "from" | "to"> {
  const [from, to] = a <= b ? [a, b] : [b, a];
  return rangeLength({ from, to }) > MAX_RANGE_DAYS ? { from, to: addDays(from, MAX_RANGE_DAYS - 1) } : { from, to };
}
