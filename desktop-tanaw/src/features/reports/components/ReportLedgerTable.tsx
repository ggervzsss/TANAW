import { useMemo, useState } from "react";
import { Download, FileText, Search } from "lucide-react";
import { Badge } from "../../../components/Badge";
import { Card } from "../../../components/Card";
import type { ReportRecord } from "../../../types/enterprise";

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
      const searchableText = [row.report.id, row.reportLabel, row.reportDescription, row.report.period ?? row.report.date, row.statusLabel].join(" ").toLowerCase();
      return matchesStatus && (!normalizedSearchQuery || searchableText.includes(normalizedSearchQuery));
    });
  }, [ledgerRows, searchQuery, statusFilter]);

  return (
    <Card className="flex flex-col overflow-hidden rounded-sm border border-gray-200 shadow-sm lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 bg-white p-5">
        <div>
          <h3 className="text-sm font-bold tracking-wider text-[#111827] uppercase">Report History</h3>
          <p className="mt-1 text-xs text-gray-500">Choose a month to prepare its report or view an earlier submission.</p>
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
          <label>
            <span className="sr-only">Filter reports by status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-9 rounded-sm border border-gray-200 bg-white px-3 text-xs font-semibold text-[#111827] transition-colors outline-none focus:border-[#065f46]"
            >
              <option value="All">All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-white p-0">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="sticky top-0 bg-gray-50 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
            <tr>
              <th className="border-b border-gray-200 px-5 py-3">Report</th>
              <th className="border-b border-gray-200 px-5 py-3">Period</th>
              <th className="border-b border-gray-200 px-5 py-3 text-right">Visitor Estimate</th>
              <th className="border-b border-gray-200 px-5 py-3">Status</th>
              <th className="border-b border-gray-200 px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredRows.map((row) => {
              const report = row.report;
              const isActive = activeLedgerKey === row.key;
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
                  <td className="px-5 py-4">
                    <p className="font-mono text-xs font-semibold text-[#111827]">{row.reportLabel}</p>
                    <p className="mt-1 text-[10px] font-semibold tracking-wider text-gray-400 uppercase">{row.reportDescription}</p>
                  </td>
                  <td className="px-5 py-4 text-sm font-medium text-gray-700">{report.period ?? report.date}</td>
                  <td className="px-5 py-4 text-right font-mono font-bold text-[#065f46]">
                    {report.metricsUnavailable?.includes("unique_visitor_estimate") ? "Unknown" : report.unique.toLocaleString()}
                  </td>
                  <td className="px-5 py-4">
                    <Badge variant={badgeVariant(row)}>{row.statusLabel}</Badge>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex justify-end gap-3 opacity-70 transition-opacity group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onPreviewReport(report);
                        }}
                        className="flex items-center gap-1 text-xs font-semibold tracking-wider text-[#065f46] uppercase hover:text-[#044a36]"
                      >
                        <FileText size={14} />
                        View
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onDownloadReport(report);
                        }}
                        className="flex items-center gap-1 text-xs font-semibold tracking-wider text-gray-500 uppercase hover:text-[#065f46]"
                        title="Download PDF"
                      >
                        <Download size={14} />
                        Download
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
  if (row.kind === "current") return "default";
  if (row.kind === "pending") return "warning";
  if (row.statusLabel === "Accepted" || row.statusLabel === "Included in Final Report") return "success";
  if (row.statusLabel === "For Review") return "info";
  if (row.statusLabel === "Needs Changes") return "warning";
  return "default";
}
