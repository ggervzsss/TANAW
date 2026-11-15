import type { DemoBreakdown, Metrics } from "../../../types/enterprise";
import { demographicCount, getDemographicTotals } from "../utils/demographics";
import { reportingMonthKey } from "../utils/reporting-period";

/** VAR1_Blank.xlsx, B10:R46: 17 columns, four residence groups, monthly totals.
 * The supplied PDF prints days 1–14 then 15–30 plus an unlabeled day row.
 * Use that row for day 31 when valid. Never spread monthly allocations over days.
 */
export const VAR1_RESIDENCES = ["This City/Municipality", "This Province", "Other Province", "Foreign Country Residence"] as const;
export const VAR1_SEX_COLUMNS = ["Male", "Female", "Total"] as const;
export const VAR1_COLUMN_WEIGHTS = [34, 51, 46, 46, 46, 46, 46, 46, 46, 46, 46, 46, 46, 46, 46, 62, 64] as const;
export const VAR1_NOTE = "Note: *Total number must be recorded, ** Sex & ***Residence entries are optional. Total number of this month must be reported.";
export type Var1Day = { day: number; weekday: string; date: string; total: number | null };
export type Var1DailyAllocation = { date: string; demo: DemoBreakdown };

/** Only explicit frontend sample allocations populate daily sex/residence cells. */
export function var1DailyCells(day: Var1Day, samples?: Var1DailyAllocation[]) {
  const sample = samples?.find((record) => record.date === day.date);
  return sample ? var1MonthlyCells(sample.demo, { entries: null, exits: null, peak: null, unique: getDemographicTotals(sample.demo).grandTotal }) : [...Array<null>(14).fill(null), day.total];
}

export function var1Days(period: string, metrics: Metrics): Var1Day[] {
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
    return { day, date, weekday: new Intl.DateTimeFormat("en", { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day))), total: observed ? record.unique_count : null };
  });
}

function recorded(value: string | undefined): number | null {
  return value?.trim() && /^\d+$/.test(value.trim()) ? demographicCount(value) : null;
}
function group(male: number | null, female: number | null): Array<number | null> {
  return [male, female, male === null && female === null ? null : (male ?? 0) + (female ?? 0)];
}

export function var1MonthlyCells(demo: DemoBreakdown, metrics: Metrics): Array<number | null> {
  const cityMale = recorded(demo.thisCityMale);
  const cityFemale = recorded(demo.thisCityFemale);
  const provinceMale = recorded(demo.thisProvMale);
  const provinceFemale = recorded(demo.thisProvFemale);
  const totals = getDemographicTotals(demo);
  return [
    ...group(cityMale, cityFemale),
    ...group(provinceMale === null ? null : Math.max(0, provinceMale - (cityMale ?? 0)), provinceFemale === null ? null : Math.max(0, provinceFemale - (cityFemale ?? 0))),
    ...group(recorded(demo.otherProvMale), recorded(demo.otherProvFemale)),
    ...group(recorded(demo.foreignMale), recorded(demo.foreignFemale)),
    [demo.thisProvMale, demo.otherProvMale, demo.foreignMale].some((value) => recorded(value) !== null) ? totals.male : null,
    [demo.thisProvFemale, demo.otherProvFemale, demo.foreignFemale].some((value) => recorded(value) !== null) ? totals.female : null,
    metrics.unique,
  ];
}

export function hasUnspecifiedCity(demo: DemoBreakdown) {
  return (demographicCount(demo.thisProvMale) > 0 && recorded(demo.thisCityMale) === null) || (demographicCount(demo.thisProvFemale) > 0 && recorded(demo.thisCityFemale) === null);
}
