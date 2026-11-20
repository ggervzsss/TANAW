import { CalendarRange, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { Panel } from "@/shared/components/panel";
import { EmptyState, FilterSelect } from "@/shared/components/ui";
import type { FinalReport } from "@/shared/types";
import { buildVar3, var3Years } from "../model/varForms";
import { downloadAnnualReportPdf } from "../utils/pdf";
import { Var3Sheet } from "./VarSheets";

type AnnualReportPanelProps = {
  finalReports: readonly FinalReport[];
  isLoading: boolean;
};

/** VAR 3M LGU Annual Report: the year's finalized VAR 2M reports compiled month by month. */
export function AnnualReportPanel({ finalReports, isLoading }: AnnualReportPanelProps) {
  const years = useMemo(() => var3Years(finalReports), [finalReports]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const year = selectedYear !== null && years.includes(selectedYear) ? selectedYear : years[0];
  const form = useMemo(() => (year === undefined ? null : buildVar3(finalReports, year)), [finalReports, year]);
  const finalizedMonths = form?.months.filter((month) => month.finalized).length ?? 0;

  if (!form || year === undefined) {
    return (
      <Panel className="overflow-hidden">
        <EmptyState
          icon={CalendarRange}
          title={isLoading ? "Loading final reports" : "No finalized monthly reports"}
          description={isLoading ? "Fetching consolidated reports from the backend." : "The annual VAR 3M compiles monthly VAR 2M reports once they are marked as Finalized."}
        />
      </Panel>
    );
  }

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-gray-50 p-4">
        <div className="min-w-60 flex-1">
          <p className="text-sm font-bold text-gray-900">VAR 3M LGU Annual Report</p>
          <p className="text-xs text-gray-500">
            {finalizedMonths} of 12 months finalized for {year}. Only Finalized monthly reports are compiled.
          </p>
        </div>
        <FilterSelect
          value={String(year)}
          onChange={(value) => setSelectedYear(Number(value))}
          options={years.map((option) => [String(option), String(option)] as const)}
          ariaLabel="Annual report year"
        />
        <button
          type="button"
          onClick={() => downloadAnnualReportPdf(finalReports, year)}
          className="bg-tanaw-green hover:bg-tanaw-green/90 inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition"
        >
          <Download size={15} /> Download PDF
        </button>
      </div>
      <div className="tanaw-document-preview bg-gray-100 p-6 dark:bg-[#0f172a]">
        <Var3Sheet form={form} />
      </div>
    </Panel>
  );
}
