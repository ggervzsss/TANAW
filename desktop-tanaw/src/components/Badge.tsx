import type { ReactNode } from "react";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

type BadgeProps = {
  children: ReactNode;
  variant?: BadgeVariant;
};

export function Badge({ children, variant = "default" }: BadgeProps) {
  const variants = {
    default: "tanaw-status-badge--default border border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-700/70 dark:text-slate-100",
    success: "tanaw-status-badge--success border border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-300/20 dark:bg-emerald-500/15 dark:text-emerald-200",
    warning: "tanaw-status-badge--warning border border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-300/24 dark:bg-amber-400/15 dark:text-amber-200",
    danger: "tanaw-status-badge--danger border border-red-200 bg-red-100 text-red-800 dark:border-red-300/24 dark:bg-red-500/15 dark:text-red-200",
    info: "tanaw-status-badge--info border border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-300/24 dark:bg-blue-500/15 dark:text-blue-200",
  };

  return <span className={`tanaw-status-badge rounded-full px-2.5 py-1 text-xs font-semibold ${variants[variant]}`}>{children}</span>;
}
