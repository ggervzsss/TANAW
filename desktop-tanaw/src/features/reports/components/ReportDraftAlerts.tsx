import { MessageSquare } from "lucide-react";
import type { ReportRecord } from "../../../types/enterprise";

type ReportDraftAlertsProps = {
  activeReport: ReportRecord | null;
};

export function ReportDraftAlerts({ activeReport }: ReportDraftAlertsProps) {
  return (
    <>
      {activeReport?.status === "Returned for Revision" && (
        <div className="tanaw-report-remarks mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-300/30 dark:bg-amber-400/10">
          <h4 className="tanaw-report-remarks__title mb-2 flex items-center gap-1.5 text-[10px] font-bold tracking-wider text-amber-900 uppercase dark:text-amber-200">
            <MessageSquare size={14} /> Staff Remarks
          </h4>
          <p className="tanaw-report-remarks__message text-xs leading-relaxed font-medium text-amber-800 dark:text-amber-100">{activeReport.remarks}</p>
        </div>
      )}
    </>
  );
}
