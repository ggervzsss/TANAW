import { Button, StatusPill } from "@/shared/ui-kit";
import type { IntakeReport } from "@/shared/types";
import { formatShortDate, reportSentAt, reviewStatus, reviewTone } from "../model/reportStatuses";
import { var2mFromIntakeReport } from "../model/varForms";
import { ReportPreviewDialog } from "./ReportPreviewDialog";
import { Var2mSheet } from "./VarSheets";

type EnterpriseReportDialogProps = {
  report: IntakeReport;
  isUpdating: boolean;
  onClose: () => void;
  onAccept: (report: IntakeReport) => void;
};

/**
 * One enterprise's monthly report on the official VAR 2M sheet. A report awaiting the staff
 * decision can be accepted; any other report opens read only. TANAW does not return submitted
 * reports to the enterprise.
 */
export function EnterpriseReportDialog({ report, isUpdating, onClose, onAccept }: EnterpriseReportDialogProps) {
  const canReview = report.status === "Pending Review";
  const review = reviewStatus(report);
  const sent = reportSentAt(report);
  const notes = report.notes?.trim();

  return (
    <ReportPreviewDialog
      title="Enterprise report"
      description={`${report.enterprise} · ${report.period}`}
      onClose={onClose}
      actions={
        canReview && (
          <Button loading={isUpdating} onClick={() => onAccept(report)}>
            Accept report
          </Button>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <StatusPill tone={reviewTone[review]}>{review}</StatusPill>
        <span className="text-[0.8125rem] wrap-anywhere text-(--tanaw-text-muted)">
          {report.code}
          {sent ? ` · Submitted ${formatShortDate(sent)} from the TANAW desktop app` : " · Sent from the TANAW desktop app"}
        </span>
      </div>
      <Var2mSheet form={var2mFromIntakeReport(report)} label={`${report.enterprise} VAR 2M`} />
      <section aria-labelledby={`${report.id}-notes`} className="space-y-1 text-sm text-(--tanaw-text-secondary)">
        <h3 id={`${report.id}-notes`} className="text-[0.9375rem] font-[650] text-(--tanaw-text)">
          Submission notes
        </h3>
        <p className="wrap-anywhere whitespace-pre-wrap">{notes || "No notes were sent with this report."}</p>
        {canReview && <p className="pt-2">Accepting marks this report Consolidated. Once every received report is consolidated, you can generate the consolidated report.</p>}
      </section>
    </ReportPreviewDialog>
  );
}
