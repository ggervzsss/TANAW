import type { ComplianceStatus, ReportWorkflowState } from "@/shared/types";
import { readableToken } from "../utils/reportWorkflow";

type ReportBadgeStatus = ReportWorkflowState | ComplianceStatus | "unknown" | "eligible" | "exempt" | "ineligible" | "pending" | "ready" | "failed" | "current" | "superseded";

export function ReportStatusBadge({ status, label }: { status: ReportBadgeStatus; label?: string }) {
  const classes =
    {
      submitted: "border-amber-200 bg-amber-50 text-amber-700",
      returned: "border-red-200 bg-red-50 text-red-700",
      accepted: "border-emerald-200 bg-emerald-50 text-emerald-700",
      consolidated: "border-blue-200 bg-blue-50 text-blue-700",
      not_submitted: "border-slate-200 bg-slate-50 text-slate-600",
      unknown: "border-orange-200 bg-orange-50 text-orange-700",
      eligible: "border-emerald-200 bg-emerald-50 text-emerald-700",
      exempt: "border-violet-200 bg-violet-50 text-violet-700",
      ineligible: "border-slate-200 bg-slate-100 text-slate-600",
      pending: "border-amber-200 bg-amber-50 text-amber-700",
      ready: "border-emerald-200 bg-emerald-50 text-emerald-700",
      failed: "border-red-200 bg-red-50 text-red-700",
      current: "border-emerald-200 bg-emerald-50 text-emerald-700",
      superseded: "border-slate-200 bg-slate-50 text-slate-600",
    }[status] ?? "border-gray-200 bg-gray-50 text-gray-600";
  return <span className={`rounded border px-2.5 py-1 text-[10px] font-bold tracking-wide uppercase ${classes}`}>{label ?? readableToken(status)}</span>;
}
