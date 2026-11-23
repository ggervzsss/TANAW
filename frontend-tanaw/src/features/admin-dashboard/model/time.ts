import { PHILIPPINE_TIME_ZONE, type SystemTimeFormat } from "@/shared/utils/dateTime";

/* Dates and times on the dashboard, read in Philippine time like the rest of the portal. */

const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: PHILIPPINE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

function toDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** The ISO day ("2026-11-23") a timestamp falls on in the Philippines, or null when unreadable. */
export function philippineDay(value: string | Date) {
  const date = toDate(value);
  return date ? dayFormat.format(date) : null;
}

function format(date: Date, timeFormat: SystemTimeFormat, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", { ...options, hour12: timeFormat === "12-hour", timeZone: PHILIPPINE_TIME_ZONE }).format(date);
}

/** "Nov 21, 6:16 PM" */
export function formatDayAndTime(value: string, timeFormat: SystemTimeFormat) {
  const date = toDate(value);
  return date ? format(date, timeFormat, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Date unavailable";
}

/** "3:15 PM" today, otherwise "Nov 21". */
export function formatRecentTime(value: string, now: Date, timeFormat: SystemTimeFormat) {
  const date = toDate(value);
  if (!date) return "Date unavailable";
  if (philippineDay(date) === philippineDay(now)) return format(date, timeFormat, { hour: "numeric", minute: "2-digit" });
  return format(date, timeFormat, { month: "short", day: "numeric" });
}

/** "3 PM" (or "15:00") for an hour bucket. */
export function formatHour(value: string, timeFormat: SystemTimeFormat) {
  const date = toDate(value);
  if (!date) return "";
  return timeFormat === "12-hour" ? format(date, timeFormat, { hour: "numeric" }) : format(date, timeFormat, { hour: "2-digit", minute: "2-digit" });
}

/** "Nov 9" for a day bucket. */
export function formatShortDay(value: string) {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat("en-US", { timeZone: PHILIPPINE_TIME_ZONE, month: "short", day: "numeric" }).format(date) : "";
}
