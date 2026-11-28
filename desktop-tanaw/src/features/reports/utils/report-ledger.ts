import type { ReportLedgerRow } from "../components/ReportLedgerTable";
import { compareMonthReports, isReopenedReport } from "../model/report-lifecycle";
import { reportingMonthKey, reportingMonthSortValue } from "./reporting-period";

/**
 * Within a month: the live month first, then its sent report, then a month still waiting for its
 * report (or a fix in progress), then the refused reports a fix replaced.
 */
function rowRank(row: ReportLedgerRow) {
  if (row.kind === "current") return 0;
  if (row.kind === "pending") return 2;
  return isReopenedReport(row.report) ? 3 : 1;
}

export function sortReportLedgerRows(rows: ReportLedgerRow[]) {
  return [...rows].sort((first, second) => {
    const firstPeriod = reportingMonthSortValue(first.report.period ?? first.report.date);
    const secondPeriod = reportingMonthSortValue(second.report.period ?? second.report.date);
    const periodDifference = secondPeriod - firstPeriod;

    if (periodDifference !== 0) return periodDifference;
    const rankDifference = rowRank(first) - rowRank(second);
    if (rankDifference !== 0) return rankDifference;
    // Reports of one month: the newest first.
    return first.kind === "history" && second.kind === "history" ? compareMonthReports(second.report, first.report) : 0;
  });
}

/**
 * The months Create Reports can switch between, oldest first: one row per reporting month, taking
 * the live month first, then a sent report, then a month still waiting for its report (a month
 * being fixed opens its draft, not the refused report it replaces).
 */
export function reportMonthRows(rows: ReportLedgerRow[]) {
  const months = new Map<string, ReportLedgerRow>();
  for (const row of sortReportLedgerRows(rows)) {
    const key = reportingMonthKey(row.report.period ?? row.report.date);
    if (!months.has(key)) months.set(key, row);
  }
  return [...months.values()].reverse();
}
