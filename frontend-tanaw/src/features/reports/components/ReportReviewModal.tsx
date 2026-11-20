import { useState } from "react";
import { Button, Textarea } from "@/design-system";
import type { IntakeReport } from "@/shared/types";
import { var2mFromIntakeReport } from "../model/varForms";
import { downloadIntakeReportPdf } from "../utils/pdf";
import { ReportActionConfirmDialog } from "./ReportActionConfirmDialog";
import { ReportPreviewDialog } from "./ReportPreviewDialog";
import { ReportStatusBadge } from "./ReportStatusBadge";
import { Var2mSheet } from "./VarSheets";

type ReportReviewModalProps = {
  report: IntakeReport;
  isUpdating: boolean;
  onClose: () => void;
  onAccept: (report: IntakeReport, remarks: string) => void;
  onReturn: (report: IntakeReport, remarks: string) => void;
};

export function ReportReviewModal({ report, isUpdating, onClose, onAccept, onReturn }: ReportReviewModalProps) {
  const [confirmAction, setConfirmAction] = useState<"accept" | "return" | null>(null);
  const [remarks, setRemarks] = useState(report.remarks ?? "");
  const canReview = report.status === "Pending Review";
  const savedRemarks = Array.from(new Set([report.notes, canReview ? undefined : report.remarks].filter((value) => value?.trim())));

  if (confirmAction) {
    const returning = confirmAction === "return";
    return (
      <ReportActionConfirmDialog
        title={returning ? "Return report for revision?" : "Accept report?"}
        message={returning ? `Send the ${report.period} report back to ${report.enterprise} for correction.` : `Mark the ${report.period} report from ${report.enterprise} ready for consolidation.`}
        confirmLabel={returning ? "Return report" : "Accept report"}
        pendingLabel="Updating..."
        destructive={returning}
        isPending={isUpdating}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => (returning ? onReturn : onAccept)(report, remarks)}
      />
    );
  }

  return (
    <ReportPreviewDialog
      title="Establishment report"
      description={`${report.enterprise} · ${report.period}`}
      onClose={onClose}
      onDownload={() => downloadIntakeReportPdf(report)}
      actions={
        canReview && (
          <>
            <Button variant="danger" onClick={() => setConfirmAction("return")}>
              Return for revision
            </Button>
            <Button onClick={() => setConfirmAction("accept")}>Accept &amp; mark ready</Button>
          </>
        )
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ReportStatusBadge status={report.status} />
        <span className="text-xs wrap-anywhere text-(--tanaw-text-muted)">{report.code}</span>
      </div>
      <Var2mSheet form={var2mFromIntakeReport(report)} label={`${report.enterprise} VAR 2M`} />
      {(canReview || savedRemarks.length > 0) && (
        <section className="space-y-2 px-2 pb-2 text-sm text-(--tanaw-text-secondary)">
          {savedRemarks.length > 0 && (
            <div className="space-y-1">
              <h3 className="font-semibold text-(--tanaw-text)">{canReview ? "Submission notes" : "Remarks"}</h3>
              {savedRemarks.map((value) => (
                <p key={value} className="wrap-anywhere whitespace-pre-wrap">
                  {value}
                </p>
              ))}
            </div>
          )}
          {canReview && (
            <label className="block max-w-2xl font-semibold text-(--tanaw-text)">
              Review remarks <span className="font-normal text-(--tanaw-text-muted)">(optional)</span>
              <Textarea className="mt-2 font-normal" rows={2} value={remarks} onChange={(event) => setRemarks(event.target.value)} />
            </label>
          )}
        </section>
      )}
    </ReportPreviewDialog>
  );
}
