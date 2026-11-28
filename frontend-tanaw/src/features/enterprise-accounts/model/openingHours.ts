import type { ApiSchemas } from "@/contracts/api";
import type { SystemDateFormat, SystemTimeFormat } from "@/shared/utils/dateTime";

/*
 * A place's opening hours: each day closed, open 24 hours, or open for one or more periods (a
 * midday break is two periods). TANAW uses them to tell an offline desktop app from a closed place.
 */
export type OpeningHours = ApiSchemas["OpeningHours"];
export type DayHours = OpeningHours["days"][number];
export type Weekday = DayHours["day"];
export type DayMode = DayHours["mode"];
export type OpeningPeriod = NonNullable<DayHours["periods"]>[number];

export const WEEKDAYS: readonly Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
export const MAX_PERIODS_PER_DAY = 4;

export const weekdayLabels: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

/** 8:00 AM to 5:00 PM every day, the form's starting point. */
export function defaultOpeningHours(): OpeningHours {
  return { days: WEEKDAYS.map((day) => ({ day, mode: "hours", periods: [{ open: "08:00", close: "17:00" }] })) };
}

export function dayHours(hours: OpeningHours, day: Weekday): DayHours {
  return hours.days.find((entry) => entry.day === day) ?? { day, mode: "closed", periods: [] };
}

export function setDayHours(hours: OpeningHours, next: DayHours): OpeningHours {
  return { days: WEEKDAYS.map((day) => (day === next.day ? next : dayHours(hours, day))) };
}

function minutes(clock: string) {
  if (clock === "24:00") return 24 * 60;
  const [hours, mins] = clock.split(":").map(Number);
  return hours * 60 + mins;
}

/** The first problem with the hours, or null when they can be saved. */
export function validateOpeningHours(hours: OpeningHours): string | null {
  for (const day of WEEKDAYS) {
    const entry = dayHours(hours, day);
    if (entry.mode !== "hours") continue;
    const periods = [...(entry.periods ?? [])].sort((left, right) => minutes(left.open) - minutes(right.open));
    if (periods.length === 0) return `Add opening times for ${weekdayLabels[day]}, or mark it closed.`;
    for (const period of periods) {
      if (!/^\d{2}:\d{2}$/.test(period.open) || !/^\d{2}:\d{2}$/.test(period.close)) return `Enter both times for ${weekdayLabels[day]}.`;
      if (minutes(period.close) <= minutes(period.open)) return `${weekdayLabels[day]}: the closing time must be later than the opening time.`;
    }
    for (let index = 1; index < periods.length; index += 1) {
      if (minutes(periods[index].open) < minutes(periods[index - 1].close)) return `${weekdayLabels[day]}'s opening times overlap.`;
    }
  }
  return null;
}

function clock12(clock: string) {
  const total = minutes(clock);
  const hours = Math.floor(total / 60) % 24;
  const mins = total % 60;
  const suffix = hours < 12 ? "AM" : "PM";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${String(mins).padStart(2, "0")} ${suffix}`;
}

/** "8:00 AM – 12:00 PM, 1:00 PM – 5:00 PM", "Open 24 hours" or "Closed". */
export function describeDay(entry: DayHours) {
  if (entry.mode === "closed") return "Closed";
  if (entry.mode === "open24h") return "Open 24 hours";
  return (entry.periods ?? []).map((period) => `${clock12(period.open)} – ${clock12(period.close)}`).join(", ");
}

export function sameOpeningHours(left: OpeningHours | null | undefined, right: OpeningHours | null | undefined) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/*
 * Read-only displays: compact times ("8 AM", "1:30 PM"), a day's hours as a sentence, and whether
 * the place is open right now. The edit form keeps its own inputs.
 */

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * A stored "HH:MM" time as people read it: "8 AM", "12 PM" and "1:30 PM" in 12-hour time (minutes
 * only when they are not zero), "08:00" and "13:30" in 24-hour time. A closing time of "24:00" is
 * midnight: "12 AM", or "24:00".
 */
export function formatClock(clock: string, timeFormat: SystemTimeFormat = "12-hour") {
  const total = minutes(clock);
  const mins = total % 60;
  if (timeFormat === "24-hour") return `${pad(Math.floor(total / 60))}:${pad(mins)}`;
  const hours = Math.floor(total / 60) % 24;
  const display = hours % 12 === 0 ? 12 : hours % 12;
  const suffix = hours < 12 ? "AM" : "PM";
  return mins === 0 ? `${display} ${suffix}` : `${display}:${pad(mins)} ${suffix}`;
}

/** "a", "a and b", "a, b and c". */
function joinWithAnd(parts: readonly string[]) {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function sortedPeriods(entry: DayHours) {
  return [...(entry.periods ?? [])].sort((left, right) => minutes(left.open) - minutes(right.open));
}

/** "8 AM to 12 PM and 1 PM to 5 PM", "Open 24 hours" or "Closed". */
export function formatDayHours(entry: DayHours, timeFormat: SystemTimeFormat = "12-hour") {
  if (entry.mode === "closed") return "Closed";
  if (entry.mode === "open24h") return "Open 24 hours";
  const periods = sortedPeriods(entry);
  if (periods.length === 0) return "Closed";
  return joinWithAnd(periods.map((period) => `${formatClock(period.open, timeFormat)} to ${formatClock(period.close, timeFormat)}`));
}

/**
 * A note for a day that closes between its periods: "Lunch break" for one break between 11 AM and
 * 2 PM, "Break" for one at another time, "2 breaks" for more. Null when the day has no break.
 */
export function dayBreakNote(entry: DayHours) {
  if (entry.mode !== "hours") return null;
  const periods = sortedPeriods(entry);
  const breaks: Array<{ start: number; end: number }> = [];
  for (let index = 1; index < periods.length; index += 1) {
    const start = minutes(periods[index - 1].close);
    const end = minutes(periods[index].open);
    if (end > start) breaks.push({ start, end });
  }
  if (breaks.length === 0) return null;
  if (breaks.length > 1) return `${breaks.length} breaks`;
  const [only] = breaks;
  return only.start >= 11 * 60 && only.end <= 14 * 60 ? "Lunch break" : "Break";
}

/** A date range the place is closed, as ISO calendar days ("2026-12-24"), both days included. */
export type ClosedSpan = { startDate: string; endDate: string };

/** The ISO day, the day of the week and the minutes since midnight in Philippine time. */
export function philippineMoment(now: Date): { date: string; weekday: Weekday; minutes: number } {
  // Philippine time is UTC+8 all year (no daylight saving), the zone opening hours are kept in.
  const local = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    weekday: WEEKDAYS[(local.getUTCDay() + 6) % 7],
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function isClosedOn(closures: readonly ClosedSpan[], isoDate: string) {
  return closures.some((closure) => closure.startDate <= isoDate && isoDate <= closure.endDate);
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * An ISO day in the system date format, without the year when it is `currentYear`: "Dec 27" or
 * "27 Dec"; the numeric formats always keep the year ("12/27/2026", "2026-12-27").
 */
export function formatIsoDay(isoDate: string, dateFormat: SystemDateFormat = "MMM d, yyyy", currentYear?: string) {
  const [year, month, day] = isoDate.split("-");
  const monthName = SHORT_MONTHS[Number(month) - 1];
  const dayNumber = String(Number(day));
  const withYear = year !== currentYear;
  if (dateFormat === "MM/dd/yyyy") return `${month}/${day}/${year}`;
  if (dateFormat === "yyyy-MM-dd") return `${year}-${month}-${day}`;
  if (dateFormat === "d MMM yyyy") return withYear ? `${dayNumber} ${monthName} ${year}` : `${dayNumber} ${monthName}`;
  return withYear ? `${monthName} ${dayNumber}, ${year}` : `${monthName} ${dayNumber}`;
}

/** The days searched for the next opening, so a long renovation still finds the day it ends. */
const OPENING_SEARCH_DAYS = 400;

/** When the place next opens after `moment`, skipping closed days and temporary closures. */
function nextOpening(hours: OpeningHours | null, closures: readonly ClosedSpan[], moment: ReturnType<typeof philippineMoment>) {
  const todayIndex = WEEKDAYS.indexOf(moment.weekday);
  for (let offset = 0; offset <= OPENING_SEARCH_DAYS; offset += 1) {
    const date = addDays(moment.date, offset);
    if (isClosedOn(closures, date)) continue;
    const weekday = WEEKDAYS[(todayIndex + offset) % 7];
    // With no hours on record TANAW counts the place as open, so it opens when a closure ends.
    const entry = hours ? dayHours(hours, weekday) : null;
    if (!entry || entry.mode === "open24h") {
      if (offset > 0) return { offset, date, weekday, clock: "00:00" };
      continue;
    }
    if (entry.mode === "closed") continue;
    const next = sortedPeriods(entry).find((period) => offset > 0 || minutes(period.open) > moment.minutes);
    if (next) return { offset, date, weekday, clock: next.open };
  }
  return null;
}

export type OpeningStatusTone = "open" | "closed" | "temporarilyClosed";
export type OpeningStatus = { tone: OpeningStatusTone; label: string };

/**
 * Whether the place is open now, in Philippine time, as a short status: "Open now, until 5 PM",
 * "Open now, all day", "Closed now, opens 1 PM", "Closed now, opens tomorrow at 8 AM", "Closed now,
 * opens Monday at 8 AM", or "Temporarily closed, opens Dec 27 at 8 AM" during a temporary closure.
 * Null when no hours are on record and no closure covers today (TANAW then counts the place as open).
 */
export function openingStatus({
  hours,
  closures,
  now,
  timeFormat = "12-hour",
  dateFormat = "MMM d, yyyy",
}: {
  hours: OpeningHours | null | undefined;
  closures: readonly ClosedSpan[];
  now: Date;
  timeFormat?: SystemTimeFormat;
  dateFormat?: SystemDateFormat;
}): OpeningStatus | null {
  const moment = philippineMoment(now);
  const temporarilyClosed = isClosedOn(closures, moment.date);
  const entry = hours ? dayHours(hours, moment.weekday) : null;

  if (!temporarilyClosed) {
    if (!hours) return null;
    if (entry?.mode === "open24h") return { tone: "open", label: "Open now, all day" };
    if (entry?.mode === "hours") {
      const periods = sortedPeriods(entry);
      const current = periods.find((period) => minutes(period.open) <= moment.minutes && moment.minutes < minutes(period.close));
      if (current) {
        // Periods that run on without a gap close together.
        let close = current.close;
        for (const period of periods) if (minutes(period.open) === minutes(close)) close = period.close;
        return { tone: "open", label: `Open now, until ${formatClock(close, timeFormat)}` };
      }
    }
  }

  const prefix = temporarilyClosed ? "Temporarily closed" : "Closed now";
  const tone: OpeningStatusTone = temporarilyClosed ? "temporarilyClosed" : "closed";
  const next = nextOpening(hours ?? null, closures, moment);
  if (!next) return { tone, label: prefix };
  const day = next.offset === 0 ? null : next.offset === 1 ? "tomorrow" : next.offset < 7 ? weekdayLabels[next.weekday] : formatIsoDay(next.date, dateFormat, moment.date.slice(0, 4));
  const time = next.clock === "00:00" ? null : formatClock(next.clock, timeFormat);
  const when = day && time ? `${day} at ${time}` : (day ?? time);
  return { tone, label: when ? `${prefix}, opens ${when}` : prefix };
}
