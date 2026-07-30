import type { ReportLedgerRow } from "../components/ReportLedgerTable";
import { reportingMonthSortValue } from "./reporting-period";

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
