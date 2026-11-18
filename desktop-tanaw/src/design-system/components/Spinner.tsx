/*
 * GENERATED FILE. Do not edit; change design-system/src/components/Spinner.tsx instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: 3562c22993f5ee59d0a67d1e5745e84817ee403e4f646cd6e1af59da371ac06b
 */
import { cn } from "../lib/cn";

export type SpinnerProps = {
  size?: number;
  /** Read by screen readers; pass "" when a parent already announces the busy state. */
  label?: string;
  className?: string;
};

/** A small rotating ring in the current text colour. */
export function Spinner({ size = 16, label = "Loading", className }: SpinnerProps) {
  return (
    <span role={label ? "status" : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true} className={cn("inline-flex shrink-0", className)}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin motion-reduce:animate-none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export type SkeletonProps = { className?: string; label?: string };

/** A pulsing placeholder block while content loads. */
export function Skeleton({ className, label }: SkeletonProps) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      className={cn("block animate-pulse rounded-tanaw-sm bg-(--tanaw-surface-strong) motion-reduce:animate-none", className ?? "h-4 w-24")}
    />
  );
}
