import { useState } from "react";
import type { FinalReport } from "@/shared/types";
import { buildVar3, var3Years } from "../model/varForms";
import { downloadAnnualReportPdf } from "../utils/pdf";
import { ReportPreviewDialog } from "./ReportPreviewDialog";
import { Var3Sheet } from "./VarSheets";

type AnnualReportDialogProps = {
  reports: readonly FinalReport[];
  preferredYear?: number;
  onClose: () => void;
};

export function AnnualReportDialog({ reports, preferredYear, onClose }: AnnualReportDialogProps) {
  const years = var3Years(reports);
  const [selectedYear, setSelectedYear] = useState(preferredYear);
  const year = selectedYear !== undefined && years.includes(selectedYear) ? selectedYear : years[0];
  const form = year === undefined ? null : buildVar3(reports, year);

  return (
    <ReportPreviewDialog title="Annual report (VAR 3M)" size={form ? "full" : "md"} onClose={onClose} onDownload={form ? () => downloadAnnualReportPdf(reports, form.year) : undefined}>
      {form ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-(--tanaw-text)">
              Report year
              <select
                className="rounded-tanaw-md border border-(--tanaw-control-border) bg-(--tanaw-control-bg) px-3 py-2 focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)"
                value={form.year}
                onChange={(event) => setSelectedYear(Number(event.target.value))}
              >
                {years.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            </label>
            <p className="text-sm text-(--tanaw-text-secondary)">{form.months.filter((month) => month.finalized).length} of 12 months finalized</p>
          </div>
          <Var3Sheet form={form} />
        </>
      ) : (
        <p className="text-sm text-(--tanaw-text-secondary)">Finalize a monthly report to start the annual report.</p>
      )}
    </ReportPreviewDialog>
  );
}
