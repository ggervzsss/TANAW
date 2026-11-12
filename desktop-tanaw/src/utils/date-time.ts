export const PHILIPPINE_TIME_ZONE = "Asia/Manila";
export const DAY_MS = 86_400_000;

export function philippineDayStart(date: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: PHILIPPINE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (name: string) => Number(parts.find((item) => item.type === name)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day")) - 8 * 60 * 60 * 1000;
}

export type SystemTimeFormat = "12-hour" | "24-hour";

type DateTimeFormatOptions = {
  dateStyle?: "full" | "long" | "medium" | "short";
  timeStyle?: "full" | "long" | "medium" | "short";
};

export function resolveSystemTimeFormat(value: unknown): SystemTimeFormat {
  return value === "24-hour" ? "24-hour" : "12-hour";
}

export function formatPhilippineDateTime(
  value: string | number | Date,
  timeFormat: SystemTimeFormat,
  options: DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "Date unavailable";

  return new Intl.DateTimeFormat("en-PH", {
    ...options,
    hour12: timeFormat === "12-hour",
    timeZone: PHILIPPINE_TIME_ZONE,
  }).format(date);
}
