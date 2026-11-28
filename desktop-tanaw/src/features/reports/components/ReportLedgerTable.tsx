import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { SelectDropdown } from "../../../components/SelectDropdown";
import { ExpandableText } from "../../../components/ExpandableText";
import { ReportPopover } from "./ReportPopover";
import { Skeleton, useSkeletonReveal } from "../../../ui-kit";
import type { ReportRecord } from "../../../types/enterprise";
import { useSystemDisplayPreferences } from "../../preferences/system-display-preferences";
import { formatPhilippineDateTime } from "../../../utils/date-time";
import { formatReportingPeriodLabel, reportingMonthKey } from "../utils/reporting-period";
import type { ReportLedgerRow } from "../model/report-ledger";
import { uploadStatusLabel } from "../model/report-workspace";
import { isReopenedReport, isUploadRejected, reportReference } from "../model/report-lifecycle";
import { REPORTING_STATUSES, REPORTING_STATUS_TONE, isSubmittedStatus } from "../model/report-status";
import { formatReportingPeriodDueDate } from "../model/reporting-calendar";

export type { ReportLedgerRow } from "../model/report-ledger";
type Props = {
  activeLedgerKey: string;
  ledgerRows: ReportLedgerRow[];
  /** True while the first reporting periods load; rows show placeholders instead of "none yet". */
  isLoading?: boolean;
  onPreviewReport: (report: ReportRecord) => void;
  onSelectReport: (row: ReportLedgerRow) => void;
};

const SKELETON_ROWS = 3;
const SKELETON_WIDTHS = ["72%", "64%", "40%", "70%", "66%", "48%"];
const COLUMN_WIDTHS = [17, 18, 16, 17, 16, 11, 5];

export function ReportLedgerTable({ activeLedgerKey, ledgerRows, isLoading = false, onPreviewReport, onSelectReport }: Props) {
  const openReport = (row: ReportLedgerRow) => {
    onSelectReport(row);
    onPreviewReport(row.report);
  };
  const { timeFormat } = useSystemDisplayPreferences();
  const [searchQuery, setSearchQuery] = useState("");
  const [periodFilter, setPeriodFilter] = useState("year");
  const [statusFilter, setStatusFilter] = useState("All");
  const thisYear = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Manila" }).format(new Date());
  const periods = useMemo(() => Array.from(new Set(ledgerRows.map((row) => row.report.period ?? row.report.date))), [ledgerRows]);
  const filteredRows = useMemo(
    () =>
      ledgerRows.filter((row) => {
        const period = row.report.period ?? row.report.date;
        const matchesPeriod =
          periodFilter === "all" || (periodFilter === "year" ? reportingMonthKey(period).startsWith(`${thisYear}-`) : reportingMonthKey(period) === reportingMonthKey(periodFilter));
        const text = [row.report.id, row.reportLabel, row.reportDescription, period, formatReportingPeriodLabel(period), row.statusLabel].join(" ").toLowerCase();
        return matchesPeriod && (statusFilter === "All" || row.statusLabel === statusFilter) && (!searchQuery.trim() || text.includes(searchQuery.trim().toLowerCase()));
      }),
    [ledgerRows, periodFilter, statusFilter, thisYear, searchQuery],
  );
  // The reports fade in where their placeholder rows stood, when those rows were seen.
  const reveal = useSkeletonReveal(isLoading && !filteredRows.length);

  return (
    <section className="report-ledger" aria-label="Report history">
      <header>
        <h2>Report History</h2>
        <p>List of reports created and submitted in the system</p>
      </header>
      <form
        className="report-history-filters"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label>
          <span>Reporting Period</span>
          <SelectDropdown
            value={periodFilter}
            onChange={setPeriodFilter}
            options={[["all", "All Periods"], ["year", `This Year (${thisYear})`], ...periods.map((period) => [period, formatReportingPeriodLabel(period)] as const)]}
            ariaLabel="Filter reports by reporting period"
            menuClassName="reports-dropdown-menu"
            restoreFocusOnTab
            reportsDismissal
          />
        </label>
        <label>
          <span>Reporting Status</span>
          <SelectDropdown
            value={statusFilter}
            onChange={setStatusFilter}
            options={[["All", "All Statuses"], ...REPORTING_STATUSES.map((status) => [status, status] as const)]}
            ariaLabel="Filter reports by status"
            menuClassName="reports-dropdown-menu"
            restoreFocusOnTab
            reportsDismissal
          />
        </label>
      </form>
      <ReportPopover className="report-history-search" label="Search reports" icon={<Search size={15} aria-hidden="true" />}>
        <label>
          <span className="sr-only">Search reports</span>
          <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search reports" />
        </label>
      </ReportPopover>
      <div className="report-history-table-scroll" tabIndex={0} role="region" aria-label="Report history table">
        <table>
          <colgroup>
            {COLUMN_WIDTHS.map((width, index) => (
              <col key={index} style={{ width: `${width}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {["Report ID", "Reporting Period", "Visitor Counted", "Status", "Date Submitted", "Time"].map((title) => (
                <th key={title} scope="col">
                  {title}
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody key={`${periodFilter}:${statusFilter}:${searchQuery}`} className="report-history-results">
            {filteredRows.map((row) => {
              const report = row.report;
              const submitted = report.submittedAt && !Number.isNaN(Date.parse(report.submittedAt)) ? report.submittedAt : null;
              return (
                <tr
                  key={row.key}
                  className={reveal}
                  role="button"
                  tabIndex={0}
                  aria-selected={activeLedgerKey === row.key}
                  aria-label={`${row.reportLabel}, ${formatReportingPeriodLabel(report.period ?? report.date)}, ${row.statusLabel}`}
                  onClick={(event) => {
                    if ((event.target as Element).closest("button, a, input, select, textarea, summary")) return;
                    openReport(row);
                  }}
                  onKeyDown={(event) => {
                    if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      openReport(row);
                    }
                  }}
                >
                  <td className="report-history-id-cell" title={row.reportDescription}>
                    <ExpandableText primary={row.kind === "history" ? reportReference(report) : report.id} ariaLabel="report name and description" className="report-history-id" />
                  </td>
                  <td>{formatReportingPeriodLabel(report.period ?? report.date)}</td>
                  <td className="report-history-count">{report.unique.toLocaleString()}</td>
                  <td>
                    <span className="report-status" data-tone={REPORTING_STATUS_TONE[row.statusLabel]}>
                      {row.statusLabel}
                    </span>
                    {/* TANAW's reason stays with the report it refused. */}
                    {row.kind === "history" && statusReason(report) ? (
                      <ExpandableText primary={statusReason(report)!} ariaLabel="reason" className="report-status-reason" />
                    ) : report.syncStatus && report.syncStatus !== "synced" ? (
                      <span className="report-upload-state" data-state={report.syncStatus}>
                        {uploadStatusLabel(report.syncStatus)}
                      </span>
                    ) : (
                      dueNote(row) && <span className="report-upload-state">{dueNote(row)}</span>
                    )}
                  </td>
                  <td>{submitted ? formatPhilippineDateTime(submitted, timeFormat, { dateStyle: "medium" }) : "—"}</td>
                  <td>{submitted ? formatPhilippineDateTime(submitted, timeFormat, { timeStyle: "short" }) : "—"}</td>
                  <td className="report-history-open" aria-hidden="true">
                    <ChevronRight />
                  </td>
                </tr>
              );
            })}
            {!filteredRows.length &&
              isLoading &&
              Array.from({ length: SKELETON_ROWS }, (_, row) => (
                <tr key={`loading-${row}`} className="report-history-skeleton-row">
                  {[...SKELETON_WIDTHS, null].map((width, column) => (
                    <td key={column}>
                      {row === 0 && column === 0 && (
                        <span className="sr-only" role="status">
                          Loading reports…
                        </span>
                      )}
                      {width && <Skeleton className="report-history-skeleton" style={{ width }} />}
                    </td>
                  ))}
                </tr>
              ))}
            {!filteredRows.length && !isLoading && (
              <tr>
                <td colSpan={7} className="report-history-empty">
                  {ledgerRows.length ? "No matching reports found." : "No reporting periods available yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** When a month not submitted yet is due ("Due Dec 10, 2026"), or was ("Was due Nov 10, 2026"). */
function dueNote(row: ReportLedgerRow) {
  if (isSubmittedStatus(row.statusLabel)) return null;
  const due = formatReportingPeriodDueDate(row.report.period ?? row.report.date);
  if (!due) return null;
  return row.statusLabel === "Missing" ? `Was due ${due}` : `Due ${due}`;
}

/** Why TANAW refused a report, and that a fixed report replaced it. */
function statusReason(report: ReportRecord) {
  if (!isUploadRejected(report)) return null;
  const reason = report.rejectionReason ?? "No reason given";
  return isReopenedReport(report) ? `${reason} · Reopened to fix` : reason;
}
