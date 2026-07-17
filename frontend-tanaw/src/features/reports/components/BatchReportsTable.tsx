import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/shared/components/ui";
import { reportPresentationStatus, type ComplianceRow } from "../utils/reportWorkflow";
import { ReportStatusBadge } from "./ReportStatusBadge";

type BatchReportsTableProps = {
  rows: ComplianceRow[];
  isLoading: boolean;
  selectedReportIds: Set<string>;
  showSelection: boolean;
  onToggleReport: (reportId: string) => void;
  onOpenReport: (reportId: string) => void;
};

export function BatchReportsTable({ rows, isLoading, selectedReportIds, showSelection, onToggleReport, onOpenReport }: BatchReportsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
          <tr>
            {showSelection && <th className="px-4 py-4">Select</th>}
            <th className="px-6 py-4">Enterprise / Site</th>
            <th className="px-6 py-4">Barangay</th>
            <th className="px-6 py-4">Status</th>
            <th className="px-6 py-4">Submitted</th>
            <th className="px-6 py-4 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-gray-800">
          {rows.map(({ obligation, report, enterpriseLabel, siteLabel }) => {
            const selectable = report?.workflowState === "accepted" && Boolean(report.acceptedRevisionId);
            const presentation = reportPresentationStatus({ obligation, report, enterpriseLabel, siteLabel });
            return (
              <tr key={obligation.obligationId} className="group hover:bg-tgreen-dark/5 transition">
                {showSelection && (
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      aria-label={`Select ${enterpriseLabel} for final report`}
                      checked={Boolean(report && selectedReportIds.has(report.enterpriseReportId))}
                      disabled={!selectable}
                      onChange={() => report && onToggleReport(report.enterpriseReportId)}
                      className="h-4 w-4 accent-emerald-700 disabled:opacity-40"
                    />
                  </td>
                )}
                <td className="px-6 py-4">
                  <div className="text-left">
                    <span className="block font-semibold">{enterpriseLabel}</span>
                    <span className="mt-1 block text-[10px] text-gray-500">{siteLabel}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-xs">{obligation.frozenBarangay ?? "Not recorded"}</td>
                <td className="px-6 py-4">
                  <ReportStatusBadge status={presentation.badgeStatus} label={presentation.label} />
                </td>
                <td className="px-6 py-4 text-xs text-slate-600">{report ? formatSubmittedAt(report.currentRevision.submittedAt) : "—"}</td>
                <td className="px-6 py-4 text-right text-xs">
                  <button
                    type="button"
                    disabled={!report}
                    onClick={() => report && onOpenReport(report.enterpriseReportId)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 font-semibold text-slate-700 transition hover:border-emerald-300 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {report?.workflowState === "submitted" ? "Review" : "View"}
                  </button>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={showSelection ? 6 : 5}>
                <EmptyState
                  icon={ClipboardList}
                  title={isLoading ? "Loading reports" : "No enterprises for this period"}
                  description={isLoading ? "Loading submission tracking." : "Submission tracking has no entries yet."}
                />
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatSubmittedAt(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" }).format(timestamp) : "Submitted";
}
