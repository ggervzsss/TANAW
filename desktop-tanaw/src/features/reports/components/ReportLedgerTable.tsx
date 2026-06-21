import { Download, Edit2, FileText, Filter } from "lucide-react";
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
  return (
    <Card className="flex flex-col overflow-hidden rounded-sm border border-gray-200 shadow-sm lg:col-span-2">
      <div className="flex items-center justify-between border-b border-gray-200 bg-white p-5">
        <h3 className="text-sm font-bold tracking-wider text-[#111827] uppercase">Submission Ledger</h3>
        <div className="flex cursor-pointer items-center gap-2 rounded-sm bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-500 transition-colors hover:text-[#111827]">
          <Filter size={14} /> Filter Records
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
            {reportsHistory.map((report) => (
              <tr key={report.id} onClick={() => onViewReport(report)} className={`group cursor-pointer transition-colors ${activeReportId === report.id ? "bg-[#065f46]/5" : "hover:bg-gray-50"}`}>
                <td className="px-5 py-4 font-mono text-xs font-semibold text-[#111827]">{report.id}</td>
                <td className="px-5 py-4 text-sm font-medium text-gray-700">{report.date}</td>
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
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onPrintReport(report);
                      }}
                      className="flex items-center text-gray-500 hover:text-[#065f46]"
                      title="Download PDF"
                    >
                      <Download size={16} />
                    </button>
                    <button
                      className={`flex items-center gap-1 text-xs font-semibold tracking-wider uppercase ${report.status === "Draft" || report.status === "Returned for Revision" ? "text-[#065f46] hover:text-[#044a36]" : "text-gray-400 hover:text-[#111827]"}`}
                    >
                      {report.status === "Draft" || report.status === "Returned for Revision" ? <Edit2 size={14} /> : <FileText size={14} />}
                      {report.status === "Draft" || report.status === "Returned for Revision" ? "Edit" : "View"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {reportsHistory.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-sm text-gray-400">
                  No reports submitted yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
