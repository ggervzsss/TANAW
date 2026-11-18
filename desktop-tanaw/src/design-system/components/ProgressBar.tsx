/*
 * GENERATED FILE. Do not edit; change design-system/src/components/ProgressBar.tsx instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: 362b4ba2ea20a818333f2ea7e58acab528829ebe41b038b3aaf0520e7ac158c0
 */
import { cn } from "../lib/cn";

export type ProgressBarProps = {
  /** 0 to max. */
  value: number;
  max?: number;
  /** Names what is measured, for screen readers and the optional visible label. */
  label: string;
  showValue?: boolean;
  tone?: "action" | "warning" | "danger";
  className?: string;
};

const tones = { action: "bg-(--tanaw-action)", warning: "bg-amber-500", danger: "bg-red-500" };

/** A thin progress bar such as report compliance; the fill is Civic Green. */
export function ProgressBar({ value, max = 100, label, showValue = false, tone = "action", className }: ProgressBarProps) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className={cn("min-w-0", className)}>
      {showValue && (
        <div className="mb-1.5 flex items-center justify-between gap-3 text-xs font-semibold text-(--tanaw-text-muted)">
          <span>{label}</span>
          <span className="tabular-nums">{Math.round(percent)}%</span>
        </div>
      )}
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-2 overflow-hidden rounded-full bg-(--tanaw-surface-strong)">
        <span className={cn("block h-full rounded-full transition-[width] duration-500", tones[tone])} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
