import { AlertTriangle, MessageSquare } from "lucide-react";
import type { ReportRecord } from "../../../types/enterprise";

type ReportDraftAlertsProps = {
  activeReport: ReportRecord | null;
  isReadOnly: boolean;
  metricsError: string | null;
};

export function ReportDraftAlerts({ activeReport, isReadOnly, metricsError }: ReportDraftAlertsProps) {
  return (
    <>
      {activeReport?.status === "Returned for Revision" && (
        <div className="tanaw-report-remarks mb-5 rounded-sm border border-amber-300 bg-amber-50 p-4 dark:border-amber-300/30 dark:bg-amber-400/10">
          <h4 className="tanaw-report-remarks__title mb-2 flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-amber-900 uppercase dark:text-amber-200">
            <MessageSquare size={14} /> Staff Remarks
          </h4>
          <p className="tanaw-report-remarks__message text-xs leading-relaxed font-medium text-amber-800 dark:text-amber-100">{activeReport.remarks}</p>
        </div>
      )}

      {metricsError && !isReadOnly && (
        <div className="mb-5 flex items-start gap-2 rounded-sm border border-red-200 bg-red-50 p-4 shadow-inner dark:border-red-400/30 dark:bg-red-500/12">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-red-600 dark:text-red-200" />
          <div>
            <h4 className="mb-1 text-[10px] font-bold tracking-wider text-red-800 uppercase dark:text-red-100">Local Metrics Unavailable</h4>
            <p className="text-xs leading-relaxed text-red-700 dark:text-red-100">{metricsError}</p>
          </div>
        </div>
      )}
    </>
  );
}
