import { useMemo, useState } from "react";
import { Download, Search } from "lucide-react";
import { SelectDropdown } from "../../../components/SelectDropdown";
import { ExpandableText } from "../../../components/ExpandableText";
import { ReportPopover } from "./ReportPopover";
import type { ReportRecord } from "../../../types/enterprise";
import { useSystemDisplayPreferences } from "../../preferences/system-display-preferences";
import { formatPhilippineDateTime } from "../../../utils/date-time";
import { formatReportingPeriodLabel, reportingMonthKey } from "../utils/reporting-period";
import type { ReportLedgerRow } from "../model/report-ledger";
import { uploadStatusLabel } from "../model/report-workspace";

export type { ReportLedgerRow } from "../model/report-ledger";
type Props = {
  activeLedgerKey: string;
  ledgerRows: ReportLedgerRow[];
  onDownloadReport: (report: ReportRecord) => void;
  onPreviewReport: (report: ReportRecord) => void;
  onSelectReport: (row: ReportLedgerRow) => void;
};

export function ReportLedgerTable({ activeLedgerKey, ledgerRows, onDownloadReport, onPreviewReport, onSelectReport }: Props) {
  const openReport = (row: ReportLedgerRow) => {
    onSelectReport(row);
    onPreviewReport(row.report);
  };
  const { timeFormat } = useSystemDisplayPreferences();
  const [searchQuery, setSearchQuery] = useState("");
  const [periodFilter, setPeriodFilter] = useState("year");
  const [statusFilter, setStatusFilter] = useState("All");
  const thisYear = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: "Asia/Manila" }).format(new Date());
  const statuses = useMemo(() => Array.from(new Set(ledgerRows.map((row) => row.statusLabel))).sort(), [ledgerRows]);
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
            options={[["All", "All Statuses"], ...statuses.map((status) => [status, status] as const)]}
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
            {[16, 17, 16, 14, 16, 10, 11].map((width, index) => (
              <col key={index} style={{ width: `${width}%` }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {["Report ID", "Reporting Period", "Visitor Counted", "Status", "Date Submitted", "Time", "Actions"].map((title) => (
                <th key={title} scope="col">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody key={`${periodFilter}:${statusFilter}:${searchQuery}`} className="report-history-results">
            {filteredRows.map((row) => {
              const report = row.report;
              const submitted = report.submittedAt && !Number.isNaN(Date.parse(report.submittedAt)) ? report.submittedAt : null;
              return (
                <tr
                  key={row.key}
                  role="button"
                  tabIndex={0}
                  aria-selected={activeLedgerKey === row.key}
                  aria-label={`${row.reportLabel}, ${formatReportingPeriodLabel(report.period ?? report.date)}`}
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
                    <ExpandableText primary={report.id} ariaLabel="report name and description" className="report-history-id" />
                  </td>
                  <td>{formatReportingPeriodLabel(report.period ?? report.date)}</td>
                  <td className="report-history-count">{report.unique.toLocaleString()}</td>
                  <td>
                    <span className="report-status" data-tone={statusTone(row)}>
                      {row.statusLabel}
                    </span>
                    {/* A rejected upload is never retried, so it must not read as waiting. */}
                    {report.syncStatus && report.syncStatus !== "synced" && (
                      <span className="report-upload-state" data-state={report.syncStatus}>
                        {uploadStatusLabel(report.syncStatus)}
                      </span>
                    )}
                  </td>
                  <td>{submitted ? formatPhilippineDateTime(submitted, timeFormat, { dateStyle: "medium" }) : "—"}</td>
                  <td>{submitted ? formatPhilippineDateTime(submitted, timeFormat, { timeStyle: "short" }) : "—"}</td>
                  <td>
                    <div className="report-history-actions">
                      <button
                        type="button"
                        className="report-view-action"
                        aria-label={`View ${row.reportLabel}`}
                        title="View report"
                        onClick={(event) => {
                          event.stopPropagation();
                          openReport(row);
                        }}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        className="report-download-action"
                        aria-label={`Download ${row.reportLabel}`}
                        title="Download PDF"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDownloadReport(report);
                        }}
                      >
                        <Download size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!filteredRows.length && (
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

function statusTone(row: ReportLedgerRow) {
  if (row.report.status === "Returned for Revision") return "returned";
  if (row.kind === "pending" || row.statusLabel === "Pending Submission") return "pending";
  if (row.report.status === "Submitted" || row.report.status === "Resubmitted") return "submitted";
  if (row.report.status === "Consolidated") return "consolidated";
  return "draft";
}
