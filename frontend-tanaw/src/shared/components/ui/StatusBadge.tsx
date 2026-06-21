import type { ReactNode } from "react";

type BadgeTone = "blue" | "green" | "slate" | "teal" | "amber" | "red";

type StatusBadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
};

const classes: Record<BadgeTone, string> = {
  amber: "bg-amber-50 text-amber-700",
  blue: "bg-blue-50 text-blue-700",
  green: "bg-emerald-50 text-emerald-700",
  red: "bg-red-50 text-red-700",
  slate: "bg-slate-100 text-slate-600",
  teal: "bg-teal-50 text-teal-700",
};

export function StatusBadge({ children, tone = "slate" }: StatusBadgeProps) {
  return <span className={`rounded-full px-3 py-1 text-[10px] font-bold whitespace-nowrap uppercase ${classes[tone]}`}>{children}</span>;
}
