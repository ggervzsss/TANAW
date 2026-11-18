import type { DailyOrigins, DemoBreakdown, Metrics } from "../../../types/enterprise";
import { demographicCount, getDemographicTotals } from "../utils/demographics";
import { reportDays, type ReportDay } from "./daily-origins";

/** VAR1_Blank.xlsx, B10:R46: 17 columns, four residence groups, monthly totals.
 * The supplied PDF prints days 1–14 then 15–30 plus an unlabeled day row.
 * Use that row for day 31 when valid.
 */
export const VAR1_RESIDENCES = ["This City/Municipality", "This Province", "Other Province", "Foreign Country Residence"] as const;
export const VAR1_SEX_COLUMNS = ["Male", "Female", "Total"] as const;
export const VAR1_COLUMN_WEIGHTS = [34, 51, 46, 46, 46, 46, 46, 46, 46, 46, 46, 46, 46, 46, 46, 62, 64] as const;
export const VAR1_NOTE = "Note: *Total number must be recorded, ** Sex & ***Residence entries are optional. Total number of this month must be reported.";
export type Var1Day = ReportDay;

export function var1Days(period: string, metrics: Metrics, origins?: DailyOrigins): Var1Day[] {
  return reportDays(period, metrics, origins);
}

type Cell = number | null;
function group(male: Cell, female: Cell, unspecified: Cell = null): Cell[] {
  const total = male === null && female === null && unspecified === null ? null : (male ?? 0) + (female ?? 0) + (unspecified ?? 0);
  return [male, female, total];
}

/**
 * One day's row. Reports with daily origins fill every residence group. This City uses TANAW's
 * male/female estimate, or a total only on days without one. Older reports carry daily totals only.
 */
export function var1DailyCells(day: Var1Day, detailed: boolean): Cell[] {
  if (!detailed || !day.unique || !day.origins) return [...Array<null>(14).fill(null), day.unique];
  const { otherCity, otherProvince, foreign } = day.origins;
  const sexed = day.thisCityMale !== null && day.thisCityFemale !== null;
  const cityMale = sexed ? (day.thisCityMale ?? 0) : 0;
  const cityFemale = sexed ? (day.thisCityFemale ?? 0) : 0;
  return [
    ...(sexed ? group(cityMale, cityFemale) : group(null, null, day.thisCity)),
    ...group(otherCity.male, otherCity.female),
    ...group(otherProvince.male, otherProvince.female),
    ...group(foreign.male, foreign.female),
    cityMale + otherCity.male + otherProvince.male + foreign.male,
    cityFemale + otherCity.female + otherProvince.female + foreign.female,
    day.unique,
  ];
}

function recorded(value: string | undefined): Cell {
  return value?.trim() && /^\d+$/.test(value.trim()) ? demographicCount(value) : null;
}

export function var1MonthlyCells(demo: DemoBreakdown, metrics: Metrics): Cell[] {
  const cityMale = recorded(demo.thisCityMale);
  const cityFemale = recorded(demo.thisCityFemale);
  const cityUnspecified = recorded(demo.thisCityUnspecified);
  const provinceMale = recorded(demo.thisProvMale);
  const provinceFemale = recorded(demo.thisProvFemale);
  const provinceUnspecified = recorded(demo.thisProvUnspecified);
  const remainder = (province: Cell, city: Cell) => (province === null ? null : Math.max(0, province - (city ?? 0)));
  const totals = getDemographicTotals(demo);
  return [
    ...group(cityMale, cityFemale, cityUnspecified),
    ...group(remainder(provinceMale, cityMale), remainder(provinceFemale, cityFemale), provinceUnspecified ? remainder(provinceUnspecified, cityUnspecified) || null : null),
    ...group(recorded(demo.otherProvMale), recorded(demo.otherProvFemale)),
    ...group(recorded(demo.foreignMale), recorded(demo.foreignFemale)),
    [demo.thisProvMale, demo.otherProvMale, demo.foreignMale].some((value) => recorded(value) !== null) ? totals.male : null,
    [demo.thisProvFemale, demo.otherProvFemale, demo.foreignFemale].some((value) => recorded(value) !== null) ? totals.female : null,
    metrics.unique,
  ];
}

export function hasUnspecifiedCity(demo: DemoBreakdown) {
  const citySplit = [demo.thisCityMale, demo.thisCityFemale, demo.thisCityUnspecified].some((value) => recorded(value) !== null);
  return !citySplit && getDemographicTotals(demo).thisProvince > 0;
}

/** Explains estimated and blank cells under the official grid. */
export function var1DataNotes(demo: DemoBreakdown, origins: DailyOrigins | undefined) {
  const sexed = (recorded(demo.thisCityMale) ?? 0) + (recorded(demo.thisCityFemale) ?? 0) > 0;
  const unspecified = (recorded(demo.thisCityUnspecified) ?? 0) > 0;
  const notes = [
    !origins
      ? "Sex and residence allocations are monthly. Unrecorded daily breakdowns are left blank."
      : sexed && unspecified
        ? "This City is counted by TANAW; male and female are TANAW estimates, and days without an estimate show a total only. Other origins are entered by the establishment."
        : sexed
          ? "This City is counted by TANAW; male and female are TANAW estimates. Other origins are entered by the establishment."
          : "This City is counted by TANAW and has no male/female estimate. Other origins are entered by the establishment.",
  ];
  if (hasUnspecifiedCity(demo)) notes.push("This Province includes existing allocations with an unspecified city split.");
  return notes;
}
