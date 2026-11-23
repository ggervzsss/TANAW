import { useId, useState } from "react";
import { Button, Dialog, StatusPill, Textarea } from "@/shared/ui-kit";
import type { IntakeReport } from "@/shared/types";
import { formatShortDate, reportSentAt, reviewStatus, reviewTone } from "../model/reportStatuses";
import { var2mFromIntakeReport } from "../model/varForms";
import { downloadIntakeReportPdf } from "../utils/pdf";
import { ReportPreviewDialog } from "./ReportPreviewDialog";
import { Var2mSheet } from "./VarSheets";

type EnterpriseReportDialogProps = {
  report: IntakeReport;
  isUpdating: boolean;
  onClose: () => void;
  onAccept: (report: IntakeReport) => void;
  onReturn: (report: IntakeReport, remarks: string) => void;
};

/**
 * One enterprise's monthly report on the official VAR 2M sheet. A report waiting for review can be
 * accepted or returned for correction; any other report opens read only.
 */
export function EnterpriseReportDialog({ report, isUpdating, onClose, onAccept, onReturn }: EnterpriseReportDialogProps) {
  const [isReturning, setIsReturning] = useState(false);
  const canReview = report.status === "Pending Review";
  const review = reviewStatus(report);
  const sent = reportSentAt(report);
  const notes = report.notes?.trim();
  const remarks = report.remarks?.trim();

  if (isReturning) {
    return <ReturnReportDialog report={report} isUpdating={isUpdating} onCancel={() => setIsReturning(false)} onReturn={(text) => onReturn(report, text)} />;
  }

  return (
    <ReportPreviewDialog
      title="Enterprise report"
      description={`${report.enterprise} · ${report.period}`}
      onClose={onClose}
      onDownload={() => downloadIntakeReportPdf(report)}
      actions={
        canReview && (
          <>
            <Button variant="secondary" disabled={isUpdating} onClick={() => setIsReturning(true)}>
              Return for correction
            </Button>
            <Button loading={isUpdating} onClick={() => onAccept(report)}>
              Accept report
            </Button>
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
      <Var2mSheet form={var2mFromIntakeReport(report)} label={`${report.enterprise} VAR 2M`} />
      <section aria-labelledby={`${report.id}-notes`} className="space-y-1 text-sm text-(--tanaw-text-secondary)">
        <h3 id={`${report.id}-notes`} className="text-sm font-bold text-(--tanaw-text)">
          Submission notes
        </h3>
        <p className="wrap-anywhere whitespace-pre-wrap">{notes || "No notes were sent with this report."}</p>
        {report.status === "Returned" && remarks && (
          <p className="pt-2 wrap-anywhere whitespace-pre-wrap">
            <span className="font-semibold text-(--tanaw-text)">Returned for correction: </span>
            {remarks}
          </p>
        )}
        {canReview && <p className="pt-2">Accepting marks this report Consolidated. Once every received report is consolidated, you can generate the consolidated report.</p>}
      </section>
    </ReportPreviewDialog>
  );
}

function ReturnReportDialog({ report, isUpdating, onCancel, onReturn }: { report: IntakeReport; isUpdating: boolean; onCancel: () => void; onReturn: (remarks: string) => void }) {
  const [remarks, setRemarks] = useState("");
  const [showError, setShowError] = useState(false);
  const fieldId = useId();
  const errorId = useId();
  const missing = !remarks.trim();

  return (
    <Dialog
      title="Return for correction"
      description={`${report.enterprise} · ${report.period}`}
      size="sm"
      onClose={() => {
        if (!isUpdating) onCancel();
      }}
      closeOnBackdrop={!isUpdating}
      footer={
        <>
          <Button variant="secondary" disabled={isUpdating} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={isUpdating}
            onClick={() => {
              if (missing) return setShowError(true);
              onReturn(remarks.trim());
            }}
          >
            Return report
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-(--tanaw-text-secondary)">The enterprise is asked to correct the report and send it again from the TANAW desktop app.</p>
      <label htmlFor={fieldId} className="mt-4 block text-sm font-semibold text-(--tanaw-text)">
        What needs correcting
      </label>
      <Textarea
        id={fieldId}
        className="mt-2"
        rows={3}
        maxLength={1000}
        value={remarks}
        invalid={showError && missing}
        aria-describedby={showError && missing ? errorId : undefined}
        onChange={(event) => setRemarks(event.target.value)}
      />
      {showError && missing && (
        <p id={errorId} className="mt-1.5 text-sm text-(--tanaw-error)">
          Say what the enterprise needs to correct.
        </p>
      )}
    </Dialog>
  );
}
