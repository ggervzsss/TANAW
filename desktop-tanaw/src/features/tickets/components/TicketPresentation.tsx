import type { ReactNode } from "react";
import type { SupportTicket } from "../services/tickets";

export function TicketStatusBadge({ status }: { status: SupportTicket["status"] }) {
  const className =
    status === "Resolved"
      ? "border-emerald-200 bg-emerald-50 text-[#065f46] dark:border-emerald-300/20 dark:bg-emerald-500/10 dark:text-emerald-200"
      : status === "In Review"
        ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-300/20 dark:bg-amber-500/10 dark:text-amber-100"
        : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-300/20 dark:bg-blue-500/10 dark:text-blue-100";
  return <span className={`rounded-full border px-3 py-1 text-[10px] font-black tracking-wide uppercase ${className}`}>{status}</span>;
}

export function TicketBadge({ children, tone }: { children: ReactNode; tone: "info" | "neutral" | "warning" }) {
  const className =
    tone === "warning"
      ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-300/20 dark:bg-amber-500/10 dark:text-amber-100"
      : tone === "info"
        ? "border-emerald-200 bg-emerald-50 text-[#065f46] dark:border-emerald-300/20 dark:bg-emerald-500/10 dark:text-emerald-200"
        : "border-gray-200 bg-gray-50 text-gray-500 dark:border-slate-600 dark:bg-[#0f172a] dark:text-slate-200";
  return <span className={`rounded-full border px-2.5 py-1 ${className}`}>{children}</span>;
}
