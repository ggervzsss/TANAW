export const PHILIPPINE_TIME_ZONE = "Asia/Manila";
export const PHILIPPINE_TIME_LABEL = "Philippine Time";

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
