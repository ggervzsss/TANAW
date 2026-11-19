import type { DailyOrigins, DayOrigins, DemoBreakdown, Metrics, OriginSexCounts } from "../../../types/enterprise";
import { reportingMonthKey } from "../utils/reporting-period";

/**
 * Daily visitor origins.
 *
 * TANAW counts every unique visitor of a day as This City and estimates how many are male and
 * female. Users enter the visitors who came from origins the cameras cannot tell (another city,
 * another province, abroad); those are deducted from This City, sex by sex. When TANAW had no
 * male/female estimate for a day, This City has a total only.
 */
export type OtherOrigin = keyof DayOrigins;
export type Sex = keyof OriginSexCounts;
export const OTHER_ORIGINS: ReadonlyArray<{ id: OtherOrigin; label: string }> = [
  { id: "otherCity", label: "Other City" },
  { id: "otherProvince", label: "Other Provinces" },
  { id: "foreign", label: "Foreign" },
];

/** complete: origins confirmed · missing: needs the user · no-visitors: nothing to allocate · upcoming: not reached yet. */
export type ReportDayStatus = "complete" | "missing" | "no-visitors" | "upcoming";
export type ReportDay = {
  date: string;
  day: number;
  /** 0 = Sunday. */
  weekdayIndex: number;
  weekday: string;
  /** Unique visitors TANAW counted; null when nothing was recorded that day. */
  unique: number | null;
  /** Confirmed origins, or null when the user has not confirmed this day. */
  origins: DayOrigins | null;
  /** Visitors left in This City after the other origins are deducted. */
  thisCity: number | null;
  /** TANAW's male/female estimate of the day's unique visitors; null when unavailable. */
  systemMale: number | null;
  systemFemale: number | null;
  /** This City's share of that estimate; null when unavailable. */
  thisCityMale: number | null;
  thisCityFemale: number | null;
  status: ReportDayStatus;
};

const REPORTING_TIME_ZONE = "Asia/Manila";

/** "November 16, 2026" for a YYYY-MM-DD business date. */
export function formatReportDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function emptyDayOrigins(): DayOrigins {
  return { otherCity: { male: 0, female: 0 }, otherProvince: { male: 0, female: 0 }, foreign: { male: 0, female: 0 } };
}

export function otherOriginsTotal(origins: DayOrigins | null) {
  if (!origins) return 0;
  return OTHER_ORIGINS.reduce((total, { id }) => total + origins[id].male + origins[id].female, 0);
}

export function reportingDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: REPORTING_TIME_ZONE }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Every day of the reporting month with TANAW's count and the user's origins. */
export function reportDays(period: string, metrics: Metrics, origins: DailyOrigins | undefined, today = reportingDateKey()): ReportDay[] {
  const key = reportingMonthKey(period);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) return [];
  const [year, month] = key.split("-").map(Number);
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const records = new Map(metrics.counting?.days.map((record) => [record.business_date, record]) ?? []);
  return Array.from({ length }, (_, index) => {
    const day = index + 1;
    const date = `${key}-${String(day).padStart(2, "0")}`;
    const record = records.get(date);
    const observed =
      record && Number.isSafeInteger(record.unique_count) && record.unique_count >= 0 && (record.covered_ms > 0 || record.qualified_observations > 0) && record.identification_state !== "unavailable";
    const unique = observed ? record.unique_count : null;
    const dayOrigins = origins?.[date] ?? null;
    const others = otherOriginsTotal(dayOrigins);
    const weekdayDate = new Date(Date.UTC(year, month - 1, day));
    const status: ReportDayStatus = date > today && !unique ? "upcoming" : !unique ? "no-visitors" : dayOrigins && others <= unique ? "complete" : "missing";
    const thisCity = unique === null ? null : Math.max(0, unique - others);
    // Only an estimate that splits exactly the counted visitors is used.
    const sexed =
      unique !== null &&
      record &&
      Number.isSafeInteger(record.male_count) &&
      Number.isSafeInteger(record.female_count) &&
      (record.male_count ?? 0) >= 0 &&
      (record.female_count ?? 0) >= 0 &&
      (record.male_count ?? 0) + (record.female_count ?? 0) === unique;
    const systemMale = sexed ? (record.male_count ?? 0) : null;
    const othersMale = OTHER_ORIGINS.reduce((total, { id }) => total + (dayOrigins?.[id].male ?? 0), 0);
    // The operator's entries are authoritative; any difference shifts within This City.
    const thisCityMale = systemMale === null || thisCity === null ? null : Math.min(thisCity, Math.max(0, systemMale - othersMale));
    return {
      date,
      day,
      weekdayIndex: weekdayDate.getUTCDay(),
      weekday: new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(weekdayDate),
      unique,
      origins: dayOrigins,
      thisCity,
      systemMale,
      systemFemale: sexed ? (record.female_count ?? 0) : null,
      thisCityMale,
      thisCityFemale: thisCityMale === null || thisCity === null ? null : thisCity - thisCityMale,
      status,
    };
  });
}

/** Sets one count and confirms the day. Values are capped so This City never goes below zero. */
export function setDayOrigin(origins: DailyOrigins, day: ReportDay, origin: OtherOrigin, sex: Sex, raw: string): DailyOrigins {
  const digits = raw.match(/^\d*/)?.[0] ?? "";
  const requested = digits === "" ? 0 : Number.parseInt(digits, 10);
  const current = origins[day.date] ?? emptyDayOrigins();
  const available = Math.max(0, (day.unique ?? 0) - (otherOriginsTotal(current) - current[origin][sex]));
  return { ...origins, [day.date]: { ...current, [origin]: { ...current[origin], [sex]: Math.min(requested, available) } } };
}

/** Confirms that every visitor of the day came from This City. */
export function confirmAllThisCity(origins: DailyOrigins, date: string): DailyOrigins {
  return { ...origins, [date]: emptyDayOrigins() };
}

export function missingDays(days: ReportDay[]) {
  return days.filter((day) => day.status === "missing");
}

export function dailyOriginsError(days: ReportDay[]) {
  const missing = missingDays(days).length;
  if (!missing) return null;
  return `Enter or confirm visitor origins for ${missing.toLocaleString()} ${missing === 1 ? "day" : "days"} before submitting.`;
}

/**
 * Monthly totals sent with the report. This City is split into male and female with TANAW's
 * estimate; days without an estimate are recorded as unspecified.
 */
export function monthlyDemoFromDays(days: ReportDay[]): DemoBreakdown {
  const sums = { cityMale: 0, cityFemale: 0, cityUnspecified: 0, ...emptyDayOrigins() };
  for (const day of days) {
    if (!day.unique) continue;
    if (day.thisCityMale !== null && day.thisCityFemale !== null) {
      sums.cityMale += day.thisCityMale;
      sums.cityFemale += day.thisCityFemale;
    } else {
      sums.cityUnspecified += day.thisCity ?? 0;
    }
    for (const { id } of OTHER_ORIGINS) {
      sums[id].male += day.origins?.[id].male ?? 0;
      sums[id].female += day.origins?.[id].female ?? 0;
    }
  }
  // Without any estimate, This City's male and female stay blank rather than zero.
  const anySexed = days.some((day) => day.unique && day.thisCityMale !== null);
  return {
    thisCityMale: anySexed ? String(sums.cityMale) : "",
    thisCityFemale: anySexed ? String(sums.cityFemale) : "",
    thisCityUnspecified: String(sums.cityUnspecified),
    thisProvMale: String(sums.cityMale + sums.otherCity.male),
    thisProvFemale: String(sums.cityFemale + sums.otherCity.female),
    thisProvUnspecified: String(sums.cityUnspecified),
    otherProvMale: String(sums.otherProvince.male),
    otherProvFemale: String(sums.otherProvince.female),
    foreignMale: String(sums.foreign.male),
    foreignFemale: String(sums.foreign.female),
  };
}

/** Adds the stored days missing from the shown origins; shown days keep their values. Unchanged input is returned as is. */
export function mergeMissingOriginDays(shown: DailyOrigins, stored: DailyOrigins): DailyOrigins {
  const added = Object.entries(stored).filter(([date]) => !(date in shown));
  return added.length ? { ...Object.fromEntries(added), ...shown } : shown;
}

export function originsFromPayload(value: unknown): DailyOrigins | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: DailyOrigins = {};
  for (const [date, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !entry || typeof entry !== "object") continue;
    const source = entry as Record<string, unknown>;
    const parsed = emptyDayOrigins();
    for (const { id } of OTHER_ORIGINS) {
      const counts = source[id] && typeof source[id] === "object" ? (source[id] as Record<string, unknown>) : {};
      parsed[id] = { male: count(counts.male), female: count(counts.female) };
    }
    result[date] = parsed;
  }
  return result;
}

function count(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
