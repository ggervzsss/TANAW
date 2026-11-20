import type { FinalReport, FinalReportSource } from "@/shared/types";

/**
 * The DOT Tourism Attraction Visitor Record templates the LGU reports with.
 *
 * VAR2M.xlsx  ("VAR 2M LGU Month Report"): one row per attraction for one month, the same
 *             residence and sex columns as VAR 1, and a "Total of this Month" row.
 * VAR3_Annual.xlsx ("VAR 3M LGU Annual Report"): January–December rows, Domestic / Foreign /
 *             Total per attraction, and a grand total. It compiles the year's finalized VAR 2M.
 *
 * Sex and residence are optional on the forms, so unrecorded cells stay blank; TANAW never
 * invents a split. The grand total is always the camera's unique-visitor count.
 */
export const VAR_LGU = { municipality: "City of San Pedro", province: "Laguna" } as const;
export const VAR_TITLE = "Tourism Attraction Visitor Record";
export const VAR_SUBTITLE = "( This recording form can be used instead of just counting the visitors )";
export const VAR_NOTE = "Note: *Total number must be recorded,  ** Sex & ***Residence entries are optional.   Total number of this month must be reported.";
export const VAR2M_RESIDENCES = ["This Municipality", "This Province", "Other Province"] as const;
export const VAR_SEX_COLUMNS = ["Male", "Female", "Total"] as const;
export const VAR3_MEASURES = ["Domestic", "Foreign", "Total"] as const;
export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

export type VarCell = number | null;
type DemographicInput = Partial<Record<string, number | string | null | undefined>> | null | undefined;

const REQUIRED_FIELDS = ["thisProvMale", "thisProvFemale", "otherProvMale", "otherProvFemale", "foreignMale", "foreignFemale"] as const;

type Recorded = Record<(typeof REQUIRED_FIELDS)[number] | "thisProvUnspecified", number> & {
  city: { male: number; female: number; unspecified: number } | null;
};

function count(value: number | string | null | undefined): number | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/** The establishment's allocation, or null when it is incomplete or does not add up to the unique count. */
export function recordedDemographics(unique: number, demographics: DemographicInput): Recorded | null {
  if (!demographics) return null;
  const values = {} as Recorded;
  for (const field of REQUIRED_FIELDS) {
    const value = count(demographics[field]);
    if (value === null) return null;
    values[field] = value;
  }
  values.thisProvUnspecified = count(demographics.thisProvUnspecified) ?? 0;
  const total = REQUIRED_FIELDS.reduce((sum, field) => sum + values[field], values.thisProvUnspecified);
  if (total !== unique) return null;

  const cityMale = count(demographics.thisCityMale);
  const cityFemale = count(demographics.thisCityFemale);
  const cityUnspecified = count(demographics.thisCityUnspecified) ?? 0;
  const fits = cityMale !== null && cityFemale !== null && cityMale <= values.thisProvMale && cityFemale <= values.thisProvFemale && cityUnspecified <= values.thisProvUnspecified;
  values.city = fits ? { male: cityMale, female: cityFemale, unspecified: cityUnspecified } : null;
  return values;
}

function group(male: number, female: number, unspecified = 0): VarCell[] {
  return [male, female, male + female + unspecified];
}

/** Sums a column the way the template's SUM() does: blanks count as zero, all blanks stay blank. */
export function sumCells(values: readonly VarCell[]): VarCell {
  return values.some((value) => value !== null) ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
}

export function sumColumns(rows: readonly (readonly VarCell[])[], width: number): VarCell[] {
  return Array.from({ length: width }, (_, column) => sumCells(rows.map((row) => row[column] ?? null)));
}

/**
 * VAR 2M columns D:R for one attraction: This Municipality, This Province (outside the
 * municipality), Other Province, Foreign, Grand Total; each Male / Female / Total.
 */
export function var2mCells(unique: number, demographics: DemographicInput): VarCell[] {
  const recorded = recordedDemographics(unique, demographics);
  if (!recorded) return [...Array<VarCell>(14).fill(null), unique];
  const city = recorded.city;
  return [
    ...(city ? group(city.male, city.female, city.unspecified) : [null, null, null]),
    ...group(recorded.thisProvMale - (city?.male ?? 0), recorded.thisProvFemale - (city?.female ?? 0), recorded.thisProvUnspecified - (city?.unspecified ?? 0)),
    ...group(recorded.otherProvMale, recorded.otherProvFemale),
    ...group(recorded.foreignMale, recorded.foreignFemale),
    recorded.thisProvMale + recorded.otherProvMale + recorded.foreignMale,
    recorded.thisProvFemale + recorded.otherProvFemale + recorded.foreignFemale,
    unique,
  ];
}

export type Var2mRow = { id: string; name: string; code: string; cells: VarCell[] };
export type Var2mForm = { period: string; municipality: string; rows: Var2mRow[]; totals: VarCell[]; notes: string[] };

type Var2mSource = { id: string; name: string; unique: number; demographics: DemographicInput };

export function buildVar2m(period: string, sources: readonly Var2mSource[]): Var2mForm {
  const rows = sources.map((source) => ({ id: source.id, name: source.name, code: "", cells: var2mCells(source.unique, source.demographics) }));
  const unrecorded = sources.filter((source) => !recordedDemographics(source.unique, source.demographics)).map((source) => source.name);
  const withoutCity = sources.filter((source) => recordedDemographics(source.unique, source.demographics)?.city === null).map((source) => source.name);
  const notes = [
    unrecorded.length ? `Sex and residence were not recorded for ${listNames(unrecorded)}; only the grand total is shown.` : "",
    withoutCity.length ? `This Province includes This Municipality for ${listNames(withoutCity)}, which recorded no municipality split.` : "",
  ].filter(Boolean);
  return {
    period,
    municipality: VAR_LGU.municipality,
    rows,
    totals: sumColumns(
      rows.map((row) => row.cells),
      15,
    ),
    notes,
  };
}

export function var2mFromFinalReport(report: Pick<FinalReport, "period" | "sources">): Var2mForm {
  return buildVar2m(
    report.period,
    report.sources.map((source: FinalReportSource) => ({ id: source.id, name: source.enterprise, unique: source.unique, demographics: source.demographics })),
  );
}

function listNames(names: string[]) {
  return names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`;
}

/** Domestic is every Philippine residence (This Municipality, This Province, Other Province). */
export function var3Cells(unique: number, demographics: DemographicInput): VarCell[] {
  const recorded = recordedDemographics(unique, demographics);
  if (!recorded) return [null, null, unique];
  const foreign = recorded.foreignMale + recorded.foreignFemale;
  return [unique - foreign, foreign, unique];
}

export type Var3Attraction = { key: string; name: string; code: string };
export type Var3Month = { month: string; finalized: boolean; reportIds: string[]; cells: VarCell[][]; grand: VarCell[] };
export type Var3Form = {
  year: number;
  municipality: string;
  province: string;
  period: string;
  attractions: Var3Attraction[];
  months: Var3Month[];
  totals: VarCell[][];
  grand: VarCell[];
  notes: string[];
};

function periodParts(period: string) {
  const [month, year] = period.trim().split(/\s+/);
  const index = MONTH_NAMES.findIndex((name) => name === month);
  return index >= 0 && /^\d{4}$/.test(year ?? "") ? { index, year: Number(year) } : null;
}

/** The years that have at least one finalized monthly report, newest first. */
export function var3Years(reports: readonly FinalReport[]) {
  const years = new Set(reports.filter((report) => report.status === "Finalized").flatMap((report) => periodParts(report.period)?.year ?? []));
  return [...years].sort((a, b) => b - a);
}

/**
 * VAR 3 for one year from the finalized monthly reports. Archived, draft and returned reports
 * are left out. Attractions are matched by name until TANAW assigns attraction codes.
 */
export function buildVar3(reports: readonly FinalReport[], year: number): Var3Form {
  const finalized = reports.filter((report) => report.status === "Finalized" && periodParts(report.period)?.year === year);
  const names = [...new Set(finalized.flatMap((report) => report.sources.map((source) => source.enterprise)))].sort((a, b) => a.localeCompare(b));
  const attractions = names.map((name) => ({ key: name, name, code: "" }));
  const months: Var3Month[] = MONTH_NAMES.map((month, index) => {
    const monthReports = finalized.filter((report) => periodParts(report.period)?.index === index);
    const cells = attractions.map((attraction) => {
      const sources = monthReports.flatMap((report) => report.sources.filter((source) => source.enterprise === attraction.key));
      const values = sources.map((source) => var3Cells(source.unique, source.demographics));
      return sumColumns(values, 3);
    });
    return { month, finalized: monthReports.length > 0, reportIds: monthReports.map((report) => report.id), cells, grand: sumColumns(cells, 3) };
  });
  const totals = attractions.map((_, index) =>
    sumColumns(
      months.map((month) => month.cells[index]),
      3,
    ),
  );
  const missing = months.filter((month) => !month.finalized).map((month) => month.month);
  const partial = months.some((month) => month.cells.some((cell) => cell[2] !== null && cell[0] === null));
  const notes = [
    missing.length === 12 ? `No monthly report (VAR 2M) has been finalized for ${year}.` : missing.length ? `No finalized monthly report (VAR 2M) for ${listMonths(missing)}.` : "",
    partial ? "Domestic and Foreign are blank where the establishment did not record residence; the total still counts those visitors." : "",
  ].filter(Boolean);
  return {
    year,
    municipality: VAR_LGU.municipality,
    province: VAR_LGU.province,
    period: `January - December ${year}`,
    attractions,
    months,
    totals,
    grand: sumColumns(
      months.map((month) => month.grand),
      3,
    ),
    notes,
  };
}

function listMonths(months: string[]) {
  return months.length === 1 ? months[0] : `${months.slice(0, -1).join(", ")} and ${months.at(-1)}`;
}

export function attractionLabel(attraction: Var3Attraction) {
  return attraction.code ? `${attraction.name} - ${attraction.code}` : attraction.name;
}

export function formatVarCell(value: VarCell) {
  return value === null ? "" : value.toLocaleString("en-US");
}
