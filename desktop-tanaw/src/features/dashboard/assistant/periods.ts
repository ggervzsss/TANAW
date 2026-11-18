import { DAY_MS, philippineDayStart } from "../../../utils/date-time";
import type { DateRange, PeriodKey } from "./types";

/** Days in each period, ending today except for yesterday. Week and month match the dashboard. */
export const PERIOD_DAYS: Record<PeriodKey, number> = { today: 1, yesterday: 1, week: 7, month: 30 };

/** Asia/Manila midnight-bounded range for a period. */
export function periodRange(period: PeriodKey, now: Date): DateRange {
  const today = philippineDayStart(now);
  const end = period === "yesterday" ? today : today + DAY_MS;
  return { start: new Date(end - PERIOD_DAYS[period] * DAY_MS).toISOString(), end: new Date(end).toISOString() };
}

/** The equal-length range immediately before ``range``. */
export function previousRange(range: DateRange): DateRange {
  const start = Date.parse(range.start);
  const length = Date.parse(range.end) - start;
  return { start: new Date(start - length).toISOString(), end: range.start };
}

export function isSingleDay(period: PeriodKey) {
  return PERIOD_DAYS[period] === 1;
}
