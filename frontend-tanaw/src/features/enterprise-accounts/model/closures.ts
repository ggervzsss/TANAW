import type { ApiSchemas } from "@/contracts/api";
import type { SystemDateFormat } from "@/shared/utils/dateTime";
import { formatIsoDay } from "./openingHours";

/*
 * Temporary closures: date ranges a place is closed for a holiday, a vacation or repairs, set by the
 * enterprise in the desktop app or by IT. TANAW never shows the place as offline on these days.
 */

export type Closure = ApiSchemas["ClosureSummary"];
export type ClosureState = "upcoming" | "ongoing" | "ended";

export const closureStateLabels: Record<ClosureState, string> = {
  upcoming: "Upcoming",
  ongoing: "Closed now",
  ended: "Ended",
};

/** Where a closure stands on `today` (an ISO day in Philippine time). */
export function closureState(closure: Pick<Closure, "startDate" | "endDate">, today: string): ClosureState {
  if (closure.endDate < today) return "ended";
  if (closure.startDate > today) return "upcoming";
  return "ongoing";
}

/**
 * The closure's days in the system date format, with the year said once when both days share it:
 * "Dec 25, 2026", "Dec 24 to Dec 26, 2026", "Dec 30, 2026 to Jan 2, 2027", "24 Dec to 26 Dec 2026",
 * or "12/24/2026 to 12/26/2026" in a numeric format.
 */
export function formatClosureDates(closure: Pick<Closure, "startDate" | "endDate">, dateFormat: SystemDateFormat = "MMM d, yyyy") {
  const { startDate, endDate } = closure;
  if (startDate === endDate) return formatIsoDay(startDate, dateFormat);
  const sameYear = startDate.slice(0, 4) === endDate.slice(0, 4);
  return `${formatIsoDay(startDate, dateFormat, sameYear ? startDate.slice(0, 4) : undefined)} to ${formatIsoDay(endDate, dateFormat)}`;
}

const STATE_ORDER: Record<ClosureState, number> = { ongoing: 0, upcoming: 1, ended: 2 };

/** Closures in the order they matter: the current one, then upcoming ones soonest first, then ended ones latest first. */
export function orderClosures<T extends Pick<Closure, "startDate" | "endDate">>(closures: readonly T[], today: string): T[] {
  return [...closures].sort((left, right) => {
    const leftState = closureState(left, today);
    const rightState = closureState(right, today);
    if (leftState !== rightState) return STATE_ORDER[leftState] - STATE_ORDER[rightState];
    if (leftState === "ended") return right.endDate.localeCompare(left.endDate);
    return left.startDate.localeCompare(right.startDate);
  });
}

/**
 * Who marked the closure. The enterprise marks its own closures from the desktop app under its
 * account name, so a closure marked under one of `enterpriseNames` says so; IT's say only the name.
 */
export function closureMarkedBy(closure: Pick<Closure, "createdBy">, enterpriseNames: ReadonlyArray<string | null | undefined>) {
  const name = closure.createdBy.trim();
  if (!name) return null;
  const key = name.toLocaleLowerCase("en");
  const fromDesktop = enterpriseNames.some((candidate) => candidate?.trim().toLocaleLowerCase("en") === key);
  return fromDesktop ? `Marked by ${name} from the desktop app` : `Marked by ${name}`;
}
