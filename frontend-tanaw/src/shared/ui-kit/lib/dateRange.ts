/*
 * Date ranges for the portal's range picker. Dates are calendar days in local time, written as
 * ISO `YYYY-MM-DD` strings so they compare and serialize simply.
 */

export type DateRangePreset = "today" | "last7" | "month" | "year" | "custom";

export type DateRange = {
  preset: DateRangePreset;
  /** First day, inclusive. */
  start: string;
  /** Last day, inclusive. */
  end: string;
};

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const DATE_RANGE_PRESETS: readonly { value: DateRangePreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "last7", label: "Last 7 days" },
  { value: "month", label: "Month" },
  { value: "year", label: "Year" },
  { value: "custom", label: "Custom range" },
];

export function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Local midnight of an ISO day. */
export function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

function addDays(value: string, days: number) {
  const date = parseIsoDate(value);
  date.setDate(date.getDate() + days);
  return toIsoDate(date);
}

function minIso(left: string, right: string) {
  return left < right ? left : right;
}

/** A whole calendar month, cut off at today for the current month. */
export function monthRange(year: number, monthIndex: number, today: Date): DateRange {
  const start = toIsoDate(new Date(year, monthIndex, 1));
  const end = minIso(toIsoDate(new Date(year, monthIndex + 1, 0)), toIsoDate(today));
  return { preset: "month", start, end };
}

/** The range a preset stands for. `shownMonth` is the calendar's visible month, used by "Month". */
export function presetRange(preset: DateRangePreset, today: Date, shownMonth?: { year: number; monthIndex: number }): DateRange {
  const todayIso = toIsoDate(today);
  if (preset === "today") return { preset, start: todayIso, end: todayIso };
  if (preset === "last7") return { preset, start: addDays(todayIso, -6), end: todayIso };
  if (preset === "year") return { preset, start: `${today.getFullYear()}-01-01`, end: todayIso };
  if (preset === "month") return monthRange(shownMonth?.year ?? today.getFullYear(), shownMonth?.monthIndex ?? today.getMonth(), today);
  return { preset, start: todayIso, end: todayIso };
}

/** A custom range from two picked days, in either order. */
export function customRange(first: string, second: string): DateRange {
  return first <= second ? { preset: "custom", start: first, end: second } : { preset: "custom", start: second, end: first };
}

export function rangeDayCount(range: Pick<DateRange, "start" | "end">) {
  return Math.round((parseIsoDate(range.end).getTime() - parseIsoDate(range.start).getTime()) / 86_400_000) + 1;
}

export function isSameDayRange(range: Pick<DateRange, "start" | "end">) {
  return range.start === range.end;
}

/** True when a timestamp (or ISO day) falls on a day inside the range. */
export function isInDateRange(value: string | Date, range: Pick<DateRange, "start" | "end">) {
  const date = typeof value === "string" ? (/^\d{4}-\d{2}-\d{2}$/.test(value) ? parseIsoDate(value) : new Date(value)) : value;
  if (Number.isNaN(date.getTime())) return false;
  const day = toIsoDate(date);
  return day >= range.start && day <= range.end;
}

function shortDay(value: string) {
  const date = parseIsoDate(value);
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

/** "Nov 1 – 23, 2026", "Nov 28 – Dec 3, 2026", "Dec 20, 2025 – Jan 5, 2026" or "Nov 5, 2026". */
export function formatRangeText(range: Pick<DateRange, "start" | "end">) {
  const start = parseIsoDate(range.start);
  const end = parseIsoDate(range.end);
  if (range.start === range.end) return `${shortDay(range.start)}, ${start.getFullYear()}`;
  if (start.getFullYear() !== end.getFullYear()) return `${shortDay(range.start)}, ${start.getFullYear()} – ${shortDay(range.end)}, ${end.getFullYear()}`;
  if (start.getMonth() === end.getMonth()) return `${shortDay(range.start)} – ${end.getDate()}, ${end.getFullYear()}`;
  return `${shortDay(range.start)} – ${shortDay(range.end)}, ${end.getFullYear()}`;
}

/** The short label on a picker trigger. */
export function formatRangeLabel(range: DateRange) {
  const start = parseIsoDate(range.start);
  if (range.preset === "today") return "Today";
  if (range.preset === "last7") return "Last 7 days";
  if (range.preset === "month") return `${MONTHS_LONG[start.getMonth()]} ${start.getFullYear()}`;
  if (range.preset === "year") return `Year ${start.getFullYear()}`;
  if (range.start === range.end) return formatRangeText(range);
  const end = parseIsoDate(range.end);
  if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) return `${shortDay(range.start)} – ${end.getDate()}`;
  return formatRangeText(range);
}

/** The muted note under "Showing …" in the picker footer. */
export function rangeNote(range: DateRange, today: Date) {
  const todayIso = toIsoDate(today);
  if (range.preset === "today") return "Today so far, updates live";
  if (range.preset === "last7") return "Includes today";
  if (range.preset === "month") return range.end === todayIso ? "This month so far" : "Whole month";
  if (range.preset === "year") return "This year so far";
  const days = rangeDayCount(range);
  return `${days} ${days === 1 ? "day" : "days"}. Select two dates to change it`;
}

/** The reporting month a range points at: the month of its last day. */
export function rangeEndMonth(range: Pick<DateRange, "end">) {
  const end = parseIsoDate(range.end);
  return { year: end.getFullYear(), monthIndex: end.getMonth(), month: MONTHS_LONG[end.getMonth()] };
}

export function monthTitle(year: number, monthIndex: number) {
  return `${MONTHS_LONG[monthIndex]} ${year}`;
}

/** Calendar cells for one month: leading and trailing days from neighbouring months fill whole Sunday-first weeks. */
export function calendarDays(year: number, monthIndex: number) {
  const first = new Date(year, monthIndex, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cellCount = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(year, monthIndex, index - startOffset + 1);
    return { iso: toIsoDate(date), day: date.getDate(), inMonth: date.getMonth() === monthIndex, weekday: date.getDay() };
  });
}

export function isValidDateRange(value: unknown): value is DateRange {
  if (!value || typeof value !== "object") return false;
  const range = value as Partial<DateRange>;
  return (
    DATE_RANGE_PRESETS.some((preset) => preset.value === range.preset) &&
    typeof range.start === "string" &&
    typeof range.end === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(range.start) &&
    /^\d{4}-\d{2}-\d{2}$/.test(range.end) &&
    range.start <= range.end
  );
}
