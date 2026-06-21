import type { ReactNode } from "react";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info";

type BadgeProps = {
  children: ReactNode;
  variant?: BadgeVariant;
};

export function Badge({ children, variant = "default" }: BadgeProps) {
  const variants = {
    default: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100",
    success: "bg-tanaw-green/10 text-tanaw-green dark:bg-emerald-500/15 dark:text-emerald-300",
    warning: "bg-[#ffd200]/20 text-tanaw-red dark:bg-yellow-400/15 dark:text-yellow-300",
    danger: "bg-[#a40e0e]/10 text-tanaw-red dark:bg-red-500/15 dark:text-red-300",
    info: "bg-[#2d5eff]/10 text-[#2d5eff] dark:bg-blue-500/15 dark:text-blue-300",
  };

  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${variants[variant]}`}>{children}</span>;
}
