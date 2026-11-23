import { useId } from "react";
import type { FinalReport } from "@/shared/types";
import { buildVar3, var3Years } from "../model/varForms";
import { downloadAnnualReportPdf } from "../utils/pdf";
import { ReportPreviewDialog } from "./ReportPreviewDialog";
import { Var3Sheet } from "./VarSheets";

type AnnualReportDialogProps = {
  reports: readonly FinalReport[];
  year: number;
  onYearChange: (year: number) => void;
  onClose: () => void;
};

/** The VAR 3M annual report for one year, built from that year's finalized monthly reports. */
export function AnnualReportDialog({ reports, year, onYearChange, onClose }: AnnualReportDialogProps) {
  const years = var3Years(reports);
  const options = years.includes(year) ? years : [year, ...years].sort((a, b) => b - a);
  const form = buildVar3(reports, year);
  const finalized = form.months.filter((month) => month.finalized).length;
  const selectId = useId();

  return (
    <ReportPreviewDialog title="Annual report (VAR 3M)" description={`${form.municipality}, ${form.province}`} onClose={onClose} onDownload={() => downloadAnnualReportPdf(reports, form.year)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor={selectId} className="text-sm font-semibold text-(--tanaw-text)">
            Report year
          </label>
          <select
            id={selectId}
            className="rounded-tanaw-md border border-(--tanaw-control-border) bg-(--tanaw-control-bg) px-3 py-2 text-sm font-semibold text-(--tanaw-text) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)"
            value={form.year}
            onChange={(event) => onYearChange(Number(event.target.value))}
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm text-(--tanaw-text-secondary)">{finalized} of 12 months finalized</p>
      </div>
      <Var3Sheet form={form} />
    </ReportPreviewDialog>
  );
}
