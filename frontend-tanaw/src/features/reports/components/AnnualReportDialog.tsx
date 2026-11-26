import type { FinalReport } from "@/shared/types";
import { buildVar3 } from "../model/varForms";
import { downloadAnnualReportPdf, printAnnualReportPdf } from "../utils/pdf";
import { ReportPreviewDialog } from "./ReportPreviewDialog";
import { Var3Sheet } from "./VarSheets";

type AnnualReportDialogProps = {
  reports: readonly FinalReport[];
  /** The year of the row the staff member opened. */
  year: number;
  onClose: () => void;
};

/** The VAR 3M annual report for one year, built from that year's finalized monthly reports. */
export function AnnualReportDialog({ reports, year, onClose }: AnnualReportDialogProps) {
  const form = buildVar3(reports, year);

  return (
    <ReportPreviewDialog
      title="Annual report (VAR 3M)"
      description={`${form.municipality}, ${form.province} · ${form.year}`}
      onClose={onClose}
      onDownload={() => downloadAnnualReportPdf(reports, form.year)}
      onPrint={() => printAnnualReportPdf(reports, form.year)}
    >
      <Var3Sheet form={form} />
    </ReportPreviewDialog>
  );
}
