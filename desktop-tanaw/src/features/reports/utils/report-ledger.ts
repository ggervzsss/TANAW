import type { ReportLedgerRow } from "../components/ReportLedgerTable";
import { reportingMonthKey, reportingMonthSortValue } from "./reporting-period";

const ROW_KIND_PRIORITY: Record<ReportLedgerRow["kind"], number> = {
  current: 0,
  history: 1,
  pending: 2,
};

export function sortReportLedgerRows(rows: ReportLedgerRow[]) {
  return [...rows].sort((first, second) => {
    const firstPeriod = reportingMonthSortValue(first.report.period ?? first.report.date);
    const secondPeriod = reportingMonthSortValue(second.report.period ?? second.report.date);
    const periodDifference = secondPeriod - firstPeriod;

    if (periodDifference !== 0) return periodDifference;
    return ROW_KIND_PRIORITY[first.kind] - ROW_KIND_PRIORITY[second.kind];
  });
}

/**
 * The months Create Reports can switch between, oldest first: one row per reporting month, taking
 * the live month first, then a submitted report, then a month still waiting for its report.
 */
export function reportMonthRows(rows: ReportLedgerRow[]) {
  const months = new Map<string, ReportLedgerRow>();
  for (const row of sortReportLedgerRows(rows)) {
    const key = reportingMonthKey(row.report.period ?? row.report.date);
    if (!months.has(key)) months.set(key, row);
  }
  return [...months.values()].reverse();
}
