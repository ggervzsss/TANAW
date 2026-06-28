import { AlertTriangle, MessageSquare } from "lucide-react";
import type { ReportRecord } from "../../../types/enterprise";

type ReportDraftAlertsProps = {
  activeReport: ReportRecord | null;
  isReadOnly: boolean;
  metricsError: string | null;
  validationError: string | null;
};

export function ReportDraftAlerts({ activeReport, isReadOnly, metricsError, validationError }: ReportDraftAlertsProps) {
  return (
    <>
      {activeReport?.status === "Returned for Revision" && (
        <div className="mb-5 rounded-sm border border-[#ffd200]/40 bg-[#ffd200]/10 p-4">
          <h4 className="text-tanaw-red mb-2 flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase">
            <MessageSquare size={14} /> Staff Remarks
          </h4>
          <p className="text-tanaw-red text-xs leading-relaxed font-medium">{activeReport.remarks}</p>
        </div>
      )}

      {metricsError && !isReadOnly && (
        <div className="mb-5 flex items-start gap-2 rounded-sm border border-red-200 bg-red-50 p-4 shadow-inner">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-600" />
          <div>
            <h4 className="mb-1 text-[10px] font-bold tracking-wider text-red-800 uppercase">Local Metrics Unavailable</h4>
            <p className="text-xs leading-relaxed text-red-700">{metricsError}</p>
          </div>
        </div>
      )}

      {validationError && !metricsError && (
        <div className={`mb-5 flex items-start gap-2 rounded-sm border p-4 shadow-inner ${isReadOnly ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}>
          <AlertTriangle size={16} className={`mt-0.5 shrink-0 ${isReadOnly ? "text-amber-700" : "text-red-600"}`} />
          <div>
            <h4 className={`mb-1 text-[10px] font-bold tracking-wider uppercase ${isReadOnly ? "text-amber-900" : "text-red-800"}`}>{isReadOnly ? "Report Integrity" : "Report Validation"}</h4>
            <p className={`text-xs leading-relaxed ${isReadOnly ? "text-amber-800" : "text-red-700"}`}>{validationError}</p>
          </div>
        </div>
      )}
    </>
  );
}
