/*
 * GENERATED FILE. Do not edit; change design-system/src/components/StatusDot.tsx instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: 8d45aaa6ba5e57c0b695a156fd472e03423d45695b1758573ec701307abe8cb0
 */
import { cn } from "../lib/cn";

export type StatusDotTone = "live" | "success" | "warning" | "danger" | "info" | "neutral";

export type StatusDotProps = {
  tone?: StatusDotTone;
  /** Glows and pulses: use only for "running now". */
  pulse?: boolean;
  /** Read by screen readers. Omit when nearby text already says the state. */
  label?: string;
  className?: string;
};

const tones: Record<StatusDotTone, string> = {
  live: "bg-(--tanaw-live) shadow-[0_0_0_3px_rgb(69_165_73/0.18)]",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  info: "bg-blue-500",
  neutral: "bg-slate-400",
};

/** A 7px state dot: the Live Green "camera running" dot or a category tone. */
export function StatusDot({ tone = "neutral", pulse = false, label, className }: StatusDotProps) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("inline-block h-1.75 w-1.75 shrink-0 rounded-full", tones[tone], pulse && "animate-pulse motion-reduce:animate-none", className)}
    />
  );
}
