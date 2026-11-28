import type { RecordStatusTone } from "@/shared/ui-kit";
import type { FinalReport, FinalReportStatus } from "@/shared/types";
import { formatMediumDate } from "./reportStatuses";
import { compareMonths, parseApiDate, parseReportingPeriod } from "./reportingMonth";
import { buildVar3, var3Years } from "./varForms";

/*
 * The Staff Consolidated Reports screen: the monthly VAR 2M reports staff generated, and the
 * annual VAR 3M report each year's finalized months add up to.
 *
 * A month consolidated before every enterprise's report is in is a Draft (gray): staff update it
 * from Reports as more reports are accepted, and it becomes final once the month is complete. A
 * finalized month is shown as Consolidated (green). Only finalized months count towards the annual
 * report; drafts are left out until they are final.
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
  Draft: { label: "Draft", tone: "waiting" },
  Archived: { label: "Archived", tone: "waiting" },
};

export function finalReportStatus(status: FinalReportStatus) {
  return finalStatus[status];
}

/** The marker on an open draft, in the preview header and on its printed pages. */
export const DRAFT_MARKER = "Draft — not final";

/**
 * The line above an open draft: "This draft includes 8 of 11 enterprises and was last updated Nov
 * 28, 2026. It is updated from Reports as the remaining reports are accepted, and becomes final
 * once every enterprise's report is in."
 */
export function draftReportSummary(report: Pick<FinalReport, "enterpriseCount" | "enterpriseTotal" | "updatedAt" | "generatedOn">) {
  const updated = parseApiDate(report.updatedAt) ?? parseApiDate(report.generatedOn);
  const total = report.enterpriseTotal >= report.enterpriseCount ? report.enterpriseTotal : report.enterpriseCount;
  const enterprises = `${report.enterpriseCount} of ${total} ${total === 1 ? "enterprise" : "enterprises"}`;
  return `This draft includes ${enterprises}${updated ? ` and was last updated ${formatMediumDate(updated)}` : ""}. It is updated from Reports as the remaining reports are accepted, and becomes final once every enterprise's report is in.`;
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

export type AnnualReportRow = {
  year: number;
  monthsIncluded: number;
  /** Months whose monthly report is still a Draft: left out of the annual report until final. */
  draftMonths: number;
  visitors: number | null;
  complete: boolean;
};

/** One row per year with a finalized month, newest first. */
export function annualReportRows(reports: readonly FinalReport[]): AnnualReportRow[] {
  return var3Years(reports).map((year) => {
    const form = buildVar3(reports, year);
    const monthsIncluded = form.months.filter((month) => month.finalized).length;
    return { year, monthsIncluded, draftMonths: form.draftMonths.length, visitors: form.grand[2] ?? null, complete: monthsIncluded === 12 };
  });
}

/** "2 drafts not counted" under the months an annual report includes; null without drafts. */
export function draftMonthsNote(draftMonths: number) {
  return draftMonths ? `${draftMonths} ${draftMonths === 1 ? "draft" : "drafts"} not counted` : null;
}
