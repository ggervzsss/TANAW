import { ClipboardList } from "lucide-react";
import { EmptyState } from "@/shared/components/ui";
import type { ComplianceRow } from "../utils/reportWorkflow";
import { ReportStatusBadge } from "./ReportStatusBadge";

type BatchReportsTableProps = {
  rows: ComplianceRow[];
  isLoading: boolean;
  selectedReportIds: Set<string>;
  selectionLocked: boolean;
  onToggleReport: (reportId: string) => void;
  onOpenReport: (reportId: string) => void;
};

export function BatchReportsTable({ rows, isLoading, selectedReportIds, selectionLocked, onToggleReport, onOpenReport }: BatchReportsTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50 text-[10px] font-bold tracking-wider text-gray-500 uppercase">
          <tr><th className="px-4 py-4">Select</th><th className="px-6 py-4">Enterprise / Site</th><th className="px-6 py-4">Frozen Barangay</th><th className="px-6 py-4">Eligibility</th><th className="px-6 py-4">Compliance</th><th className="px-6 py-4">Evidence</th></tr>
        </thead>
        <tbody className="divide-y divide-gray-100 text-gray-800">
          {rows.map(({ obligation, report, enterpriseLabel, siteLabel }) => {
            const selectable = report?.workflowState === "accepted" && Boolean(report.acceptedRevisionId);
            return (
              <tr key={obligation.obligationId} className="group hover:bg-tgreen-dark/5 transition">
                <td className="px-4 py-4">
                  <input type="checkbox" aria-label={`Select ${enterpriseLabel} for finalization`} checked={Boolean(report && selectedReportIds.has(report.enterpriseReportId))} disabled={!selectable || selectionLocked} onChange={() => report && onToggleReport(report.enterpriseReportId)} className="h-4 w-4 accent-emerald-700 disabled:opacity-40" />
                </td>
                <td className="px-6 py-4">
                  <button type="button" disabled={!report} onClick={() => report && onOpenReport(report.enterpriseReportId)} className="text-left disabled:cursor-default">
                    <span className="block font-semibold group-hover:text-emerald-800">{enterpriseLabel}</span>
                    <span className="mt-1 block text-[10px] text-gray-500">{siteLabel}</span>
                  </button>
                </td>
                <td className="px-6 py-4 text-xs">{obligation.frozenBarangay ?? "Not recorded"}</td>
                <td className="px-6 py-4"><ReportStatusBadge status={obligation.eligibilityStatus} /></td>
                <td className="px-6 py-4"><ReportStatusBadge status={obligation.complianceStatus ?? "unknown"} /></td>
                <td className="px-6 py-4 text-xs">
                  {report ? <><span className="font-mono">rev {report.currentRevision.revisionNumber}</span><span className="mt-1 block text-gray-500">{report.currentRevision.evidenceStatus} · {report.currentRevision.coverage.evidenceStatus}</span></> : <span className="font-semibold text-red-700">No submitted report resource</span>}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && <tr><td colSpan={6}><EmptyState icon={ClipboardList} title={isLoading ? "Loading obligations" : "No frozen obligations"} description={isLoading ? "Fetching the authoritative period compliance snapshot." : "No obligation rows were returned for this period."} /></td></tr>}
        </tbody>
      </table>
    </div>
  );
}
