import { StatusPill } from "@/shared/ui-kit";
import type { FinalReport } from "@/shared/types";
import { DRAFT_MARKER, draftReportSummary } from "../model/consolidatedReports";
import { var2mFromFinalReport } from "../model/varForms";
import { downloadFinalReportPdf, printFinalReportPdf } from "../utils/pdf";
import { ReportPreviewDialog } from "./ReportPreviewDialog";
import { Var2mSheet } from "./VarSheets";

type MonthlyReportDialogProps = {
  report: FinalReport;
  onClose: () => void;
};

/**
 * One month's consolidated report (VAR 2M). A draft is marked "Draft — not final" in the header
 * and on its printed pages; it is updated, and finalized, from Reports rather than here.
 */
export function MonthlyReportDialog({ report, onClose }: MonthlyReportDialogProps) {
  const draft = report.status === "Draft";

  return (
    <ReportPreviewDialog
      title="Monthly report (VAR 2M)"
      description={
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span>{`${report.period} · ${report.id}`}</span>
          {draft && (
            <StatusPill tone="waiting" className="min-w-0">
              {DRAFT_MARKER}
            </StatusPill>
          )}
        </span>
      }
      onClose={onClose}
      onDownload={() => downloadFinalReportPdf(report)}
      onPrint={() => printFinalReportPdf(report)}
    >
      {draft && <p className="max-w-[72ch] text-sm leading-relaxed text-(--tanaw-text-secondary)">{draftReportSummary(report)}</p>}
      <Var2mSheet form={var2mFromFinalReport(report)} label={`VAR 2M ${report.period}`} />
    </ReportPreviewDialog>
  );
}
