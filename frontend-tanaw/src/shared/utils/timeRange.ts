export type ActivityTimeRange = "All Time" | "Today" | "Last 7 Days" | "Last 30 Days";

export const activityTimeRanges: ActivityTimeRange[] = ["All Time", "Today", "Last 7 Days", "Last 30 Days"];

export function isWithinActivityTimeRange(timestamp: string, range: ActivityTimeRange, now = new Date()) {
  if (range === "All Time") return true;

  const date = parseActivityTimestamp(timestamp);
  if (!date) return false;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const time = date.getTime();

  if (range === "Today") {
    return time >= startOfToday && time <= now.getTime();
  }

  const days = range === "Last 7 Days" ? 7 : 30;
  const start = new Date(now);
  start.setDate(start.getDate() - days);
  return time >= start.getTime() && time <= now.getTime();
}

export function parseActivityTimestamp(timestamp: string) {
  const parsed = Date.parse(timestamp);
  if (!Number.isNaN(parsed)) return new Date(parsed);

  const match = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(AM|PM)$/i);
  if (!match) return null;

  const [, year, month, day, rawHour, minute, second = "0", meridiem] = match;
  let hour = Number(rawHour);
  if (meridiem.toUpperCase() === "PM" && hour < 12) hour += 12;
  if (meridiem.toUpperCase() === "AM" && hour === 12) hour = 0;

  return new Date(Number(year), Number(month) - 1, Number(day), hour, Number(minute), Number(second));
}
