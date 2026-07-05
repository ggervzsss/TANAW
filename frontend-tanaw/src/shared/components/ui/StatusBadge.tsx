import type { ReactNode } from "react";

type BadgeTone = "blue" | "green" | "slate" | "teal" | "amber" | "red";

type StatusBadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
};

const classes: Record<BadgeTone, string> = {
  amber: "bg-amber-50 text-amber-700 dark:bg-amber-400/15 dark:text-amber-200",
  blue: "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200",
  green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
  red: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-200",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-200",
  teal: "bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-200",
};

export function StatusBadge({ children, tone = "slate" }: StatusBadgeProps) {
  return <span className={`rounded-full px-3 py-1 text-[10px] font-bold whitespace-nowrap uppercase ${classes[tone]}`}>{children}</span>;
}
