import { MessageSquare } from "lucide-react";
import type { ReportRecord } from "../../../types/enterprise";

type ReportDraftAlertsProps = {
  activeReport: ReportRecord | null;
};

export function ReportDraftAlerts({ activeReport }: ReportDraftAlertsProps) {
  return (
    <>
      {activeReport?.status === "Returned for Revision" && (
        <div className="tanaw-report-remarks">
          <h4 className="tanaw-report-remarks__title">
            <MessageSquare size={15} aria-hidden="true" /> Staff Remarks
          </h4>
          <p className="tanaw-report-remarks__message">{activeReport.remarks}</p>
        </div>
      )}
    </>
  );
}
