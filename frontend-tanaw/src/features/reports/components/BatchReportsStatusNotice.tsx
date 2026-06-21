import { CheckCircle2 } from "lucide-react";

type BatchReportsStatusNoticeProps = {
  allConsolidated: boolean;
  allReady: boolean;
  filteredReportCount: number;
  readyReportCount: number;
  enterpriseCount: number;
};

export function BatchReportsStatusNotice({ allConsolidated, allReady, filteredReportCount, readyReportCount, enterpriseCount }: BatchReportsStatusNoticeProps) {
  if (allConsolidated) {
    return (
      <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-5 py-2.5 text-xs text-emerald-700">
        <CheckCircle2 size={14} className="shrink-0" />
        <span>
          <span className="font-semibold">Selected reporting cycle complete -</span> All reports have been consolidated and the final report has been generated.
        </span>
      </div>
    );
  }

  if (!allReady && filteredReportCount > 0) {
    return (
      <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-5 py-2.5 text-xs text-amber-700">
        <span className="font-semibold">Not ready to generate -</span>
        {readyReportCount} of {enterpriseCount} enterprises are marked Ready to Consolidate. All must be ready before a final report can be generated.
      </div>
    );
  }

  return null;
}
