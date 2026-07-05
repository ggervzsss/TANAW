import type { FinalReportStatus, ReportStatus } from "@/shared/types";

export function ReportStatusBadge({ status }: { status: ReportStatus | FinalReportStatus }) {
  const classes =
    status === "Pending Review"
      ? "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-300/30 dark:bg-yellow-400/15 dark:text-yellow-200"
      : status === "Ready to Consolidate" || status === "Finalized"
        ? "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-300/30 dark:bg-teal-500/15 dark:text-teal-200"
        : status === "Returned" || status === "Returned for Revision" || status === "Missing"
          ? "border-red-200 bg-red-50 text-red-700 dark:border-red-300/30 dark:bg-red-500/15 dark:text-red-200"
          : status === "Consolidated" || status === "Draft"
            ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-300/30 dark:bg-blue-500/15 dark:text-blue-200"
            : status === "Archived"
              ? "border-gray-200 bg-gray-100 text-gray-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300"
              : "border-gray-300 bg-gray-200 text-gray-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200";

  return <span className={`rounded border px-2.5 py-1 text-[10px] font-bold tracking-wide uppercase ${classes}`}>{status}</span>;
}
