import { History } from "lucide-react";
import { Alert, Badge, Button, StatusPill } from "@/shared/ui-kit";
import type { IntakeReport } from "@/shared/types";
import { canReturnReport, replacedVersionNote } from "../model/reportReturns";
import { formatShortDate, isReturned, reportSentAt, reportVersion, returnedNote, reviewStatus, reviewTone } from "../model/reportStatuses";
import { var2mFromIntakeReport } from "../model/varForms";
import { ReportPreviewDialog } from "./ReportPreviewDialog";
import { Var2mSheet } from "./VarSheets";

type EnterpriseReportDialogProps = {
  report: IntakeReport;
  /** The returned version this report replaces, when it is a corrected version and still listed. */
  previousVersion?: IntakeReport;
  isUpdating: boolean;
  onClose: () => void;
  onAccept: (report: IntakeReport) => void;
  /** Opens the return dialog; staff write what needs correcting there. */
  onReturn: (report: IntakeReport) => void;
};

/**
 * One enterprise's monthly report on the official VAR 2M sheet. A report awaiting the staff decision
 * can be accepted; a waiting or accepted report can be returned to the enterprise for correction.
 * A returned report opens read only with the reason, and a corrected version names the one it
 * replaces.
 */
export function EnterpriseReportDialog({ report, previousVersion, isUpdating, onClose, onAccept, onReturn }: EnterpriseReportDialogProps) {
  const canReview = report.status === "Pending Review";
  const canReturn = canReturnReport(report);
  const review = reviewStatus(report);
  const sent = reportSentAt(report);
  const notes = report.notes?.trim();
  const version = reportVersion(report);
  const replaces = replacedVersionNote(report, previousVersion);

  return (
    <ReportPreviewDialog
      title="Enterprise report"
      description={
        <>
          {report.enterprise} · {report.period}
          {version > 1 && (
            <Badge size="sm" tone="info" className="ml-2 align-middle">
              {`Version ${version}`}
            </Badge>
          )}
        </>
      }
      onClose={onClose}
      actions={
        (canReturn || canReview) && (
          <>
            {canReturn && (
              <Button variant="danger" disabled={isUpdating} onClick={() => onReturn(report)}>
                Return for correction
              </Button>
            )}
            {canReview && (
              <Button loading={isUpdating} onClick={() => onAccept(report)}>
                Accept report
              </Button>
            )}
          </>
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
      {isReturned(report) && (
        <Alert tone="warning" title="Returned for correction">
          <p className="wrap-anywhere whitespace-pre-wrap">{returnedNote(report)}</p>
          <p className="mt-1">{report.enterprise} can send a corrected version from the desktop app. This report stays out of the consolidated report.</p>
        </Alert>
      )}
      {replaces && (
        <p className="flex items-start gap-2 text-sm text-(--tanaw-text-secondary)">
          <History size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-(--tanaw-text-muted)" />
          <span className="min-w-0 wrap-anywhere">{replaces}</span>
        </p>
      )}
      <Var2mSheet form={var2mFromIntakeReport(report)} label={`${report.enterprise} VAR 2M`} />
      <section aria-labelledby={`${report.id}-notes`} className="space-y-1 text-sm text-(--tanaw-text-secondary)">
        <h3 id={`${report.id}-notes`} className="text-[0.9375rem] font-[650] text-(--tanaw-text)">
          Submission notes
        </h3>
        <p className="wrap-anywhere whitespace-pre-wrap">{notes || "No notes were sent with this report."}</p>
        {canReview && (
          <p className="pt-2">
            Accepting marks this report Consolidated. Once every received report is consolidated, you can generate the consolidated report. If something needs fixing, return it for correction instead.
          </p>
        )}
      </section>
    </ReportPreviewDialog>
  );
}
