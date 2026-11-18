/*
 * GENERATED FILE. Do not edit; change design-system/src/components/DetailField.tsx instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: f651e5423a2abcd51516eb683e9f97f0eec7448c748c5672faf4b5112f12a3a7
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type DetailFieldProps = {
  label: string;
  value: ReactNode;
  /** "card" is a framed inset tile (detail dialogs); "plain" is label above value with no frame. */
  variant?: "card" | "plain";
  className?: string;
};

/** A label and value pair for detail dialogs and summaries. */
export function DetailField({ label, value, variant = "card", className }: DetailFieldProps) {
  return (
    <div data-detail-field className={cn(variant === "card" && "rounded-tanaw-md border border-(--tanaw-border-soft) bg-(--tanaw-surface-inset) p-4", className)}>
      <p className="mb-1.5 text-xs font-bold tracking-label text-(--tanaw-text-muted) uppercase">{label}</p>
      <div className="text-sm leading-relaxed font-semibold wrap-break-word text-(--tanaw-text)">{value}</div>
    </div>
  );
}

export type DetailListProps = {
  items: ReadonlyArray<{ label: string; value: ReactNode }>;
  /** Columns at wide widths; always one column on phones. */
  columns?: 1 | 2 | 3;
  className?: string;
};

/** Several label and value pairs as a description list. */
export function DetailList({ items, columns = 2, className }: DetailListProps) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-4", columns === 2 && "sm:grid-cols-2", columns === 3 && "sm:grid-cols-2 lg:grid-cols-3", className)}>
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <dt className="text-xs font-bold tracking-label text-(--tanaw-text-muted) uppercase">{item.label}</dt>
          <dd className="mt-1 text-sm font-semibold wrap-break-word text-(--tanaw-text)">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
