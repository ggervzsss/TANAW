import { useMemo, useState } from "react";
import { Download, FileText, Search } from "lucide-react";
import { Badge } from "../../../components/Badge";
import { Card } from "../../../components/Card";
import { ExpandableText } from "../../../components/ExpandableText";
import { SelectDropdown } from "../../../components/SelectDropdown";
import type { ReportRecord } from "../../../types/enterprise";
import { formatReportingPeriodLabel } from "../utils/reporting-period";

export type ReportLedgerRowKind = "current" | "pending" | "history";

export type ReportLedgerRow = {
  key: string;
  kind: ReportLedgerRowKind;
  report: ReportRecord;
  reportLabel: string;
  reportDescription: string;
  statusLabel: string;
};

type ReportLedgerTableProps = {
  activeLedgerKey: string;
  ledgerRows: ReportLedgerRow[];
  onDownloadReport: (report: ReportRecord) => void;
  onPreviewReport: (report: ReportRecord) => void;
  onSelectReport: (row: ReportLedgerRow) => void;
};

export function ReportLedgerTable({ activeLedgerKey, ledgerRows, onDownloadReport, onPreviewReport, onSelectReport }: ReportLedgerTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const statusOptions = useMemo(() => Array.from(new Set(ledgerRows.map((row) => row.statusLabel))).sort(), [ledgerRows]);
  const filteredRows = useMemo(() => {
    const normalizedSearchQuery = searchQuery.trim().toLowerCase();
    return ledgerRows.filter((row) => {
      const matchesStatus = statusFilter === "All" || row.statusLabel === statusFilter;
      const storedPeriod = row.report.period ?? row.report.date;
      const searchableText = [row.report.id, row.reportLabel, row.reportDescription, storedPeriod, formatReportingPeriodLabel(storedPeriod), row.statusLabel].join(" ").toLowerCase();
      return matchesStatus && (!normalizedSearchQuery || searchableText.includes(normalizedSearchQuery));
    });
  }, [ledgerRows, searchQuery, statusFilter]);

  return (
    <Card className="flex flex-col overflow-hidden rounded-sm border border-gray-200 shadow-sm lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 bg-white p-5">
        <div>
          <h3 className="text-sm font-bold tracking-wider text-[#111827] uppercase">Report Submissions</h3>
          <p className="mt-1 text-xs text-gray-500">Select a row to load its data into the workspace, or use View to open the DOT form preview.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label className="relative block">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
            <span className="sr-only">Search reports</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search reports"
              className="h-9 w-44 rounded-sm border border-gray-200 bg-white py-2 pr-3 pl-9 text-xs font-semibold text-[#111827] transition-colors outline-none focus:border-[#065f46]"
            />
          </label>
          <SelectDropdown
            value={statusFilter}
            onChange={setStatusFilter}
            options={[["All", "All statuses"], ...statusOptions.map((status) => [status, status] as const)]}
            ariaLabel="Filter reports by status"
            size="compact"
          />
        </div>
      </div>

      <div className="flex-1 overflow-x-hidden overflow-y-auto bg-white p-0">
        <table className="w-full table-fixed text-left text-sm">
          <colgroup>
            <col className="w-[31%]" />
            <col className="w-[23%]" />
            <col className="w-[11%]" />
            <col className="w-[20%]" />
            <col className="w-[15%]" />
          </colgroup>
          <thead className="sticky top-0 bg-gray-50 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
            <tr>
              <th className="border-b border-gray-200 px-3 py-3 xl:px-5">Report</th>
              <th className="border-b border-gray-200 px-3 py-3 whitespace-nowrap xl:px-5">Period</th>
              <th className="border-b border-gray-200 px-3 py-3 text-right whitespace-nowrap xl:px-5">Unique Pax</th>
              <th className="border-b border-gray-200 px-3 py-3 whitespace-nowrap xl:px-5">Status</th>
              <th className="border-b border-gray-200 px-3 py-3 text-right whitespace-nowrap xl:px-5">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredRows.map((row) => {
              const report = row.report;
              const isActive = activeLedgerKey === row.key;
              const periodLabel = formatReportingPeriodLabel(report.period ?? report.date);
              return (
                <tr
                  key={row.key}
                  role="button"
                  tabIndex={0}
                  aria-selected={isActive}
                  onClick={() => onSelectReport(row)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelectReport(row);
                    }
                  }}
                  className={`group cursor-pointer transition-colors focus-visible:bg-[#065f46]/5 focus-visible:outline-none ${isActive ? "bg-[#065f46]/5" : "hover:bg-gray-50"}`}
                >
                  <td className="px-3 py-4 xl:px-5">
                    <ExpandableText
                      primary={row.reportLabel}
                      secondary={row.reportDescription}
                      ariaLabel="report name and description"
                      className="font-mono text-xs font-semibold text-[#111827]"
                      secondaryClassName="text-[10px] font-semibold tracking-wider text-gray-400 uppercase"
                    />
                  </td>
                  <td className="px-3 py-4 text-sm font-medium text-gray-700 xl:px-5">{periodLabel}</td>
                  <td className="px-3 py-4 text-right font-mono font-bold whitespace-nowrap text-[#065f46] xl:px-5">{report.unique?.toLocaleString() || 0}</td>
                  <td className="px-3 py-4 whitespace-nowrap xl:px-5" title={row.statusLabel}>
                    <Badge variant={badgeVariant(row)}>
                      <span className="xl:hidden">{compactStatusLabel(row)}</span>
                      <span className="hidden xl:inline">{row.statusLabel}</span>
                    </Badge>
                  </td>
                  <td className="px-3 py-4 text-right whitespace-nowrap xl:px-5">
                    <div className="flex flex-nowrap justify-end gap-3 opacity-70 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        aria-label={`View ${row.reportLabel}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onPreviewReport(report);
                        }}
                        className="flex shrink-0 items-center gap-1 text-xs font-semibold tracking-wider whitespace-nowrap text-[#065f46] uppercase hover:text-[#044a36]"
                        title="View report"
                      >
                        <FileText size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Download ${row.reportLabel}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onDownloadReport(report);
                        }}
                        className="flex shrink-0 items-center gap-1 text-xs font-semibold tracking-wider whitespace-nowrap text-gray-500 uppercase hover:text-[#065f46]"
                        title="Download PDF"
                      >
                        <Download size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-400">
                  {ledgerRows.length === 0 ? "No reporting periods available yet." : "No reports match the current filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function badgeVariant(row: ReportLedgerRow) {
  if (row.kind === "current") return "success";
  if (row.kind === "pending") return "warning";
  if (row.report.status === "Consolidated") return "success";
  if (row.report.status === "Submitted" || row.report.status === "Resubmitted") return "info";
  if (row.report.status === "Returned for Revision") return "warning";
  return "default";
}

function compactStatusLabel(row: ReportLedgerRow) {
  if (row.kind === "current") return "Current";
  if (row.kind === "pending") return "Pending";
  if (row.report.status === "Returned for Revision") return "Returned";
  return row.statusLabel;
}
