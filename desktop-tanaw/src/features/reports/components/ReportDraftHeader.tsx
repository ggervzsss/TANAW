import { FileText, History } from "lucide-react";
import type { ReportRecord } from "../../../types/enterprise";

type ReportDraftHeaderProps = {
  activeReport: ReportRecord | null;
  activeReportId: string | null;
  isReadOnly: boolean;
};

export function ReportDraftHeader({ activeReport, activeReportId, isReadOnly }: ReportDraftHeaderProps) {
  const title = getReportWorkspaceTitle(activeReport, activeReportId, isReadOnly);

  return (
    <h3 className="mb-5 flex items-center gap-2.5 border-b border-gray-100 pb-3 text-[13px] font-bold tracking-[0.12em] text-[#111827] uppercase dark:border-white/8 dark:text-slate-100">
      {isReadOnly ? <History size={18} className="text-gray-500" /> : <FileText size={18} className="text-[#065f46]" />}
      {title}
      <span className="sr-only">{activeReport?.id}</span>
    </h3>
  );
}

function getReportWorkspaceTitle(activeReport: ReportRecord | null, activeReportId: string | null, isReadOnly: boolean) {
  if (!activeReport) return "Report Workspace";
  if (activeReport.status === "Returned for Revision") return `Revise Report: ${activeReportId}`;
  if (isReadOnly) return `Submitted Report Details: ${activeReportId}`;
  return `Edit Report: ${activeReportId}`;
}
