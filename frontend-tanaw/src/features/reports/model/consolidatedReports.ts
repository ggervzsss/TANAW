import type { RecordStatusTone } from "@/shared/ui-kit";
import type { FinalReport, FinalReportStatus } from "@/shared/types";
import { formatMediumDate } from "./reportStatuses";
import { compareMonths, parseApiDate, parseReportingPeriod } from "./reportingMonth";
import { buildVar3, var3Years } from "./varForms";

/*
 * The Staff Consolidated Reports screen: the monthly VAR 2M reports staff generated, and the
 * annual VAR 3M report each year's finalized months add up to.
 *
 * A generated monthly report starts as a Draft; staff finalize it from its dialog. Only finalized
 * months count towards the annual report, so a finalized month is shown as Consolidated.
 */

export const CONSOLIDATED_TABS = ["monthly", "annual"] as const;
export type ConsolidatedTab = (typeof CONSOLIDATED_TABS)[number];

export function parseConsolidatedTab(value: string | null | undefined): ConsolidatedTab {
  return value === "annual" ? "annual" : "monthly";
}

export function parseYear(value: string | null | undefined) {
  return /^\d{4}$/.test(value ?? "") ? Number(value) : null;
}

const finalStatus: Record<FinalReportStatus, { label: string; tone: RecordStatusTone }> = {
  Finalized: { label: "Consolidated", tone: "consolidated" },
  Draft: { label: "Draft", tone: "pending" },
  Archived: { label: "Archived", tone: "waiting" },
};

export function finalReportStatus(status: FinalReportStatus) {
  return finalStatus[status];
}

export function finalReportYear(report: Pick<FinalReport, "period">) {
  return parseReportingPeriod(report.period)?.year ?? null;
}

/** Years with a monthly report, plus the current year, newest first. */
export function consolidatedReportYears(reports: readonly FinalReport[], currentYear: number) {
  const years = new Set([currentYear, ...reports.flatMap((report) => finalReportYear(report) ?? [])]);
  return [...years].sort((a, b) => b - a);
}

/** The year to show first: the newest year that has a monthly report, or the current year. */
export function defaultConsolidatedYear(reports: readonly FinalReport[], currentYear: number) {
  const years = reports.flatMap((report) => finalReportYear(report) ?? []);
  return years.length ? Math.max(...years) : currentYear;
}

/** One year's monthly reports, latest month first; a month's newer report comes first. */
export function monthlyReportsForYear(reports: readonly FinalReport[], year: number) {
  return reports
    .flatMap((report) => {
      const month = parseReportingPeriod(report.period);
      return month?.year === year ? [{ report, month }] : [];
    })
    .sort((a, b) => compareMonths(b.month, a.month) || (parseApiDate(b.report.generatedOn)?.getTime() ?? 0) - (parseApiDate(a.report.generatedOn)?.getTime() ?? 0))
    .map(({ report }) => report);
}

/** "Oct 9, 2026", or the stored text when it is not a date. */
export function formatGeneratedOn(value: string) {
  const date = parseApiDate(value);
  return date ? formatMediumDate(date) : value;
}

/** "11 of 12" against the enterprises registered now, or just "11" when that count is unknown or smaller. */
export function enterpriseCoverage(included: number, registered: number | null) {
  return registered && registered >= included ? `${included} of ${registered}` : String(included);
}

export type AnnualReportRow = { year: number; monthsIncluded: number; visitors: number | null; complete: boolean };

/** One row per year with a finalized month, newest first. */
export function annualReportRows(reports: readonly FinalReport[]): AnnualReportRow[] {
  return var3Years(reports).map((year) => {
    const form = buildVar3(reports, year);
    const monthsIncluded = form.months.filter((month) => month.finalized).length;
    return { year, monthsIncluded, visitors: form.grand[2] ?? null, complete: monthsIncluded === 12 };
  });
}
