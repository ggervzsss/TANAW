export const PHILIPPINE_TIME_ZONE = "Asia/Manila";

export type SystemTimeFormat = "12-hour" | "24-hour";

type DateTimeFormatOptions = {
  dateStyle?: "full" | "long" | "medium" | "short";
  timeStyle?: "full" | "long" | "medium" | "short";
};

export function resolveSystemTimeFormat(value: unknown): SystemTimeFormat {
  return value === "24-hour" ? "24-hour" : "12-hour";
}

export function formatPhilippineDateTime(value: string | number | Date | null | undefined, timeFormat: SystemTimeFormat, options: DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" }) {
  if (value === null || value === undefined || value === "") return "Date unavailable";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return new Intl.DateTimeFormat("en-PH", {
    ...options,
    hour12: timeFormat === "12-hour",
    timeZone: PHILIPPINE_TIME_ZONE,
  }).format(date);
}

export type SystemDateFormat = "MMM d, yyyy" | "d MMM yyyy" | "MM/dd/yyyy" | "yyyy-MM-dd";

export const SYSTEM_DATE_FORMATS: readonly SystemDateFormat[] = ["MMM d, yyyy", "d MMM yyyy", "MM/dd/yyyy", "yyyy-MM-dd"];

export function resolveSystemDateFormat(value: unknown): SystemDateFormat {
  return SYSTEM_DATE_FORMATS.find((format) => format === value) ?? "MMM d, yyyy";
}

function toValidDate(value: string | number | Date | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function philippineParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: PHILIPPINE_TIME_ZONE }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return { year: part("year"), month: part("month"), day: part("day") };
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A Philippine calendar date in the system date format: "Nov 25, 2026", "25 Nov 2026", "11/25/2026" or "2026-11-25". */
export function formatPhilippineDate(value: string | number | Date | null | undefined, dateFormat: SystemDateFormat = "MMM d, yyyy") {
  const date = toValidDate(value);
  if (!date) return "Date unavailable";
  const { year, month, day } = philippineParts(date);
  const monthName = SHORT_MONTHS[Number(month) - 1];
  const dayNumber = String(Number(day));
  if (dateFormat === "d MMM yyyy") return `${dayNumber} ${monthName} ${year}`;
  if (dateFormat === "MM/dd/yyyy") return `${month}/${day}/${year}`;
  if (dateFormat === "yyyy-MM-dd") return `${year}-${month}-${day}`;
  return `${monthName} ${dayNumber}, ${year}`;
}

/** A Philippine clock time in the system time format: "3:51 PM" or "15:51". */
export function formatPhilippineTime(value: string | number | Date | null | undefined, timeFormat: SystemTimeFormat = "12-hour") {
  const date = toValidDate(value);
  if (!date) return "Time unavailable";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: timeFormat === "12-hour", timeZone: PHILIPPINE_TIME_ZONE }).format(date);
}

/** "Nov 25, 2026, 3:51 PM" in the system date and time formats. */
export function formatPhilippineDateAndTime(value: string | number | Date | null | undefined, dateFormat: SystemDateFormat = "MMM d, yyyy", timeFormat: SystemTimeFormat = "12-hour") {
  const date = toValidDate(value);
  if (!date) return "Date unavailable";
  return `${formatPhilippineDate(date, dateFormat)}, ${formatPhilippineTime(date, timeFormat)}`;
}
