import type { FinalReportStatus, ReportStatus } from "@/shared/types";

export function ReportStatusBadge({ status }: { status: ReportStatus | FinalReportStatus }) {
  const classes =
    status === "Pending Review"
      ? "bg-yellow-50 text-yellow-700 border-yellow-200"
      : status === "Ready to Consolidate" || status === "Finalized"
        ? "bg-teal-50 text-teal-700 border-teal-200"
        : status === "Returned" || status === "Missing"
          ? "bg-red-50 text-red-700 border-red-200"
          : status === "Consolidated" || status === "Draft"
            ? "bg-blue-50 text-blue-700 border-blue-200"
            : status === "Archived"
              ? "bg-gray-100 text-gray-500 border-gray-200"
              : "bg-gray-200 text-gray-700 border-gray-300";

  return <span className={`rounded border px-2.5 py-1 text-[10px] font-bold tracking-wide uppercase ${classes}`}>{status}</span>;
}
