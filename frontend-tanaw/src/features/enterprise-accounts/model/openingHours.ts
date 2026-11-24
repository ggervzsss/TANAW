import type { ApiSchemas } from "@/contracts/api";

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
