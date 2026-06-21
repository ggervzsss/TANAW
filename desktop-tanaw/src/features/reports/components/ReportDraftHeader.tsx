import { FileText, History } from "lucide-react";
import type { ReportRecord } from "../../../types/enterprise";

type ReportDraftHeaderProps = {
  activeReport: ReportRecord | null;
  activeReportId: string | null;
  isReadOnly: boolean;
};

export function ReportDraftHeader({ activeReport, activeReportId, isReadOnly }: ReportDraftHeaderProps) {
  return (
    <h3 className="mb-5 flex items-center gap-2 border-b border-gray-100 pb-2 text-sm font-bold tracking-wider text-[#111827] uppercase">
      {isReadOnly ? <History size={18} className="text-gray-500" /> : <FileText size={18} className="text-[#065f46]" />}
      {isReadOnly ? "Report Details (Locked)" : activeReportId ? `Edit Report: ${activeReportId}` : "Draft Generator"}
      <span className="sr-only">{activeReport?.id}</span>
    </h3>
  );
}
