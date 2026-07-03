import { useMemo, useState } from "react";
import { Download, Edit2, FileText, Search } from "lucide-react";
import { Badge } from "../../../components/Badge";
import { Card } from "../../../components/Card";
import type { ReportRecord } from "../../../types/enterprise";

type ReportLedgerTableProps = {
  activeReportId: string | null;
  reportsHistory: ReportRecord[];
  onViewReport: (report: ReportRecord) => void;
  onPrintReport: (report: ReportRecord) => void;
};

export function ReportLedgerTable({ activeReportId, reportsHistory, onViewReport, onPrintReport }: ReportLedgerTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const statusOptions = useMemo(() => Array.from(new Set(reportsHistory.map((report) => report.status))).sort(), [reportsHistory]);
  const filteredReports = useMemo(() => {
    const normalizedSearchQuery = searchQuery.trim().toLowerCase();
    return reportsHistory.filter((report) => {
      const matchesStatus = statusFilter === "All" || report.status === statusFilter;
      const searchableText = [report.id, report.period ?? report.date, report.status].join(" ").toLowerCase();
      return matchesStatus && (!normalizedSearchQuery || searchableText.includes(normalizedSearchQuery));
    });
  }, [reportsHistory, searchQuery, statusFilter]);

  return (
    <Card className="flex flex-col overflow-hidden rounded-sm border border-gray-200 shadow-sm lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 bg-white p-5">
        <div>
          <h3 className="text-sm font-bold tracking-wider text-[#111827] uppercase">Submission Ledger</h3>
          <p className="mt-1 text-xs text-gray-500">Use View or Edit to load a saved report into the workspace.</p>
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
              className="h-9 w-44 rounded-sm border border-gray-200 bg-white py-2 pr-3 pl-9 text-xs font-semibold text-[#111827] outline-none transition-colors focus:border-[#065f46]"
            />
          </label>
          <label>
            <span className="sr-only">Filter reports by status</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-9 rounded-sm border border-gray-200 bg-white px-3 text-xs font-semibold text-[#111827] outline-none transition-colors focus:border-[#065f46]"
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
              <th className="border-b border-gray-200 px-5 py-3">Report ID</th>
              <th className="border-b border-gray-200 px-5 py-3">Period</th>
              <th className="border-b border-gray-200 px-5 py-3 text-right">Unique Pax</th>
              <th className="border-b border-gray-200 px-5 py-3">Status</th>
              <th className="border-b border-gray-200 px-5 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredReports.map((report) => {
              const isEditable = report.status === "Draft" || report.status === "Returned for Revision";
              return (
                <tr key={report.id} className={`group transition-colors ${activeReportId === report.id ? "bg-[#065f46]/5" : "hover:bg-gray-50"}`}>
                  <td className="px-5 py-4 font-mono text-xs font-semibold text-[#111827]">{report.id}</td>
                  <td className="px-5 py-4 text-sm font-medium text-gray-700">{report.period ?? report.date}</td>
                  <td className="px-5 py-4 text-right font-mono font-bold text-[#065f46]">{report.unique?.toLocaleString() || 0}</td>
                  <td className="px-5 py-4">
                    <Badge
                      variant={
                        report.status === "Consolidated"
                          ? "success"
                          : report.status === "Submitted" || report.status === "Resubmitted"
                            ? "info"
                            : report.status === "Returned for Revision"
                              ? "warning"
                              : "default"
                      }
                    >
                      {report.status}
                    </Badge>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex justify-end gap-3 opacity-60 transition-opacity group-hover:opacity-100">
                      <button type="button" onClick={() => onPrintReport(report)} className="flex items-center text-gray-500 hover:text-[#065f46]" title="Download PDF">
                        <Download size={16} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onViewReport(report)}
                        className={`flex items-center gap-1 text-xs font-semibold tracking-wider uppercase ${isEditable ? "text-[#065f46] hover:text-[#044a36]" : "text-gray-400 hover:text-[#111827]"}`}
                      >
                        {isEditable ? <Edit2 size={14} /> : <FileText size={14} />}
                        {isEditable ? "Edit" : "View"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredReports.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-400">
                  {reportsHistory.length === 0 ? "No reports submitted yet." : "No reports match the current filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
