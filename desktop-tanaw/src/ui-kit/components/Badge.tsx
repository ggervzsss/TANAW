import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { toSentenceCase } from "../lib/sentence-case";

export type BadgeTone = "success" | "warning" | "danger" | "info" | "neutral" | "teal" | "purple";

export type BadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
  /** A leading dot; "pulse" animates it for live states. */
  dot?: boolean | "pulse";
  size?: "sm" | "md";
  /** "pill" by default; "square" for code-like tags such as report numbers. */
  shape?: "pill" | "square";
  /** Turns plain-text labels into sentence case ("In Review" becomes "In review"). On by default. */
  sentenceCase?: boolean;
  className?: string;
  title?: string;
};

const tones: Record<BadgeTone, { badge: string; dot: string }> = {
  success: { badge: "border-(--tanaw-success-line) bg-(--tanaw-success-bg) text-(--tanaw-success-text)", dot: "bg-emerald-500" },
  warning: { badge: "border-(--tanaw-warning-line) bg-(--tanaw-warning-bg) text-(--tanaw-warning-text)", dot: "bg-amber-500" },
  danger: { badge: "border-(--tanaw-danger-line) bg-(--tanaw-danger-bg) text-(--tanaw-danger-text)", dot: "bg-red-500" },
  info: { badge: "border-(--tanaw-info-line) bg-(--tanaw-info-bg) text-(--tanaw-info-text)", dot: "bg-blue-500" },
  neutral: { badge: "border-(--tanaw-neutral-line) bg-(--tanaw-neutral-bg) text-(--tanaw-neutral-text)", dot: "bg-slate-400" },
  teal: { badge: "border-teal-200 bg-teal-50 text-teal-800 dark:border-teal-300/25 dark:bg-teal-500/15 dark:text-teal-200", dot: "bg-teal-500" },
  purple: { badge: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-300/25 dark:bg-violet-500/15 dark:text-violet-200", dot: "bg-violet-500" },
};

/** A status badge: a tinted pill in sentence case. Badges state a condition; they are never actions. */
export function Badge({ children, tone = "neutral", dot = false, size = "md", shape = "pill", sentenceCase = true, className, title }: BadgeProps) {
  const style = tones[tone];
  const label = sentenceCase && typeof children === "string" ? toSentenceCase(children) : children;
  return (
    <span
      title={title}
      data-tone={tone}
      className={cn(
        "tanaw-badge inline-flex max-w-full items-center gap-1.5 border font-semibold whitespace-nowrap",
        shape === "pill" ? "rounded-full" : "rounded-tanaw-sm",
        size === "sm" ? "px-2 py-0.5 text-[0.6875rem] leading-4" : "px-2.5 py-1 text-xs leading-4",
        style.badge,
        className,
      )}
    >
      {dot && <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", style.dot, dot === "pulse" && "animate-pulse motion-reduce:animate-none")} />}
      <span className="min-w-0 truncate">{label}</span>
    </span>
  );
}
