import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  minHeightClassName?: string;
  action?: ReactNode;
};

export function EmptyState({ icon: Icon, title, description, minHeightClassName = "min-h-55", action }: EmptyStateProps) {
  return (
    <div className={`flex ${minHeightClassName} flex-col items-center justify-center px-6 py-10 text-center`}>
      <span className="tanaw-data-empty-icon bg-tgreen-dark/10 text-tgreen-dark flex h-12 w-12 items-center justify-center rounded-xl dark:bg-emerald-500/10 dark:text-emerald-200">
        <Icon size={22} />
      </span>
      <p className="mt-4 text-base font-bold text-gray-900 dark:text-slate-100">{title}</p>
      <p className="mt-1.5 max-w-md text-sm leading-relaxed text-gray-500 dark:text-slate-300">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
