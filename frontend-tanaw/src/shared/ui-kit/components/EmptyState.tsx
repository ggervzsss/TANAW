import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type EmptyStateProps = {
  /** The section's icon, shown in a 48px Inset tile (a lucide icon at 22px fits). */
  icon: ReactNode;
  /** One bold line: what is missing ("No LGU accounts"). */
  title: string;
  /** One sentence: what will appear here, or what to do next. */
  description: ReactNode;
  action?: ReactNode;
  /** Tailwind min-height class for the block; defaults to min-h-55. */
  minHeightClassName?: string;
  className?: string;
};

/** What a list, table or panel shows when it has nothing to show. */
export function EmptyState({ icon, title, description, action, minHeightClassName = "min-h-55", className }: EmptyStateProps) {
  return (
    <div className={cn("tanaw-empty-state flex flex-col items-center justify-center px-6 py-10 text-center", minHeightClassName, className)}>
      <span aria-hidden="true" className="tanaw-data-empty-icon flex h-12 w-12 items-center justify-center rounded-tanaw-md bg-(--tanaw-surface-inset) text-(--tanaw-accent-ink)">
        {icon}
      </span>
      <p className="mt-4 text-base font-bold text-(--tanaw-text)">{title}</p>
      <div className="mt-1.5 max-w-md text-sm leading-relaxed text-(--tanaw-text-muted)">{description}</div>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
