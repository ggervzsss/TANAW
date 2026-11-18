/*
 * GENERATED FILE. Do not edit; change design-system/src/patterns/PageHeader.tsx instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: 56c2043a129c46c5693f02abd3a9362203c789b0ec7194157a1d5e856ffe6417
 */
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export type PageHeaderProps = {
  /** Display font, Ink (never navy). */
  title: ReactNode;
  /** A Gold Ink uppercase label above the title. */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** Page-level actions on the right, for example the primary button. */
  actions?: ReactNode;
  className?: string;
};

/** The top of a page: optional eyebrow, the page title, one line of description and page actions. */
export function PageHeader({ title, eyebrow, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("tanaw-page-header flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="mb-1.5 text-xs font-bold tracking-label text-(--tanaw-gold-ink) uppercase">{eyebrow}</p>}
        <h1 className="font-display text-2xl leading-tight font-bold tracking-[-0.01em] text-(--tanaw-text) sm:text-3xl">{title}</h1>
        {description && <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-(--tanaw-text-muted) sm:text-base">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
