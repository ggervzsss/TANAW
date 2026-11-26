import type { ApiSchemas } from "../../../contracts/api";

/*
 * Opening hours: each day closed, open 24 hours, or open for one or more periods (a midday
 * break is two periods). TANAW shows the place as offline only while it is open.
 */
export type OpeningHours = ApiSchemas["OpeningHours"];
export type DayHours = OpeningHours["days"][number];
export type Weekday = DayHours["day"];
export type DayMode = DayHours["mode"];
export type Closure = ApiSchemas["ClosureSummary"];

export const WEEKDAYS: readonly Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
export const weekdayLabels: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

export function defaultOpeningHours(): OpeningHours {
  return { days: WEEKDAYS.map((day) => ({ day, mode: "hours", periods: [{ open: "08:00", close: "17:00" }] })) };
}

/** The hours the profile form starts from: the saved hours, or the default week when none are saved. */
export function savedOpeningHours(saved: OpeningHours | null | undefined): OpeningHours {
  return saved ?? defaultOpeningHours();
}

/** A stable key for comparing two sets of hours by content, whatever order the days or fields came in. */
export function openingHoursKey(hours: OpeningHours) {
  return JSON.stringify(
    WEEKDAYS.map((day) => {
      const entry = dayHours(hours, day);
      return [day, entry.mode, (entry.periods ?? []).map((period) => [period.open, period.close])];
    }),
  );
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

/** The first problem with the hours, or "" when they can be saved. */
export function validateOpeningHours(hours: OpeningHours) {
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
  return "";
}
