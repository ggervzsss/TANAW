import type { SupportTicketCategory, SupportTicketPriority, SupportTicketStatus } from "@/shared/services/supportTickets";
import { ticketStatusLabel } from "../model";

export function TicketStatusBadge({ status }: { status: SupportTicketStatus }) {
  const classes: Record<SupportTicketStatus, string> = {
    Open: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-300/30 dark:bg-blue-500/15 dark:text-blue-200",
    "In Review": "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-300/30 dark:bg-amber-400/15 dark:text-amber-200",
    Resolved: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/30 dark:bg-emerald-500/15 dark:text-emerald-200",
  };
  return <span className={`rounded-full border px-3 py-1 text-[10px] font-black tracking-wide whitespace-nowrap uppercase ${classes[status]}`}>{ticketStatusLabel(status)}</span>;
}

export function PriorityBadge({ priority }: { priority: SupportTicketPriority }) {
  const classes: Record<SupportTicketPriority, string> = {
    Urgent: "bg-red-50 text-red-700 ring-red-100 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-300/20",
    High: "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-400/15 dark:text-amber-200 dark:ring-amber-300/20",
    Normal: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:ring-slate-600",
    Low: "bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-300/20",
  };
  return <span className={`rounded-full px-3 py-1 text-[10px] font-black tracking-wide whitespace-nowrap uppercase ring-1 ${classes[priority]}`}>{priority}</span>;
}

export function CategoryBadge({ category }: { category: SupportTicketCategory }) {
  return (
    <span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-black tracking-wide whitespace-nowrap text-emerald-700 uppercase ring-1 ring-emerald-100 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-300/20">
      {category}
    </span>
  );
}
