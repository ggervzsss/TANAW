import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import type { RecordStatusTone } from "../lib/recordStatus";

const toneClass: Record<RecordStatusTone, string> = {
  submitted: "bg-(--tanaw-st-submitted-bg) text-(--tanaw-st-submitted)",
  consolidated: "bg-(--tanaw-st-consolidated-bg) text-(--tanaw-st-consolidated)",
  reviewing: "bg-(--tanaw-st-reviewing-bg) text-(--tanaw-st-reviewing)",
  pending: "bg-(--tanaw-st-pending-bg) text-(--tanaw-st-pending)",
  waiting: "bg-(--tanaw-st-waiting-bg) text-(--tanaw-st-waiting)",
  missing: "bg-(--tanaw-st-missing-bg) text-(--tanaw-st-missing)",
};

export type StatusPillProps = {
  tone: RecordStatusTone;
  children: ReactNode;
  className?: string;
  title?: string;
};

/** A tinted status pill with no border or icon, at least 6rem wide so columns of pills line up. */
export function StatusPill({ tone, children, className, title }: StatusPillProps) {
  return (
    <span
      title={title}
      data-status={tone}
      className={cn("inline-flex min-h-6.5 min-w-24 items-center justify-center rounded-full px-3 text-[0.8125rem] leading-tight font-semibold whitespace-nowrap", toneClass[tone], className)}
    >
      {children}
    </span>
  );
}
