import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export type CardPadding = "none" | "sm" | "md" | "lg";

export type CardProps = HTMLAttributes<HTMLElement> & {
  /** The element to render: div (default), section, article or li. */
  as?: "div" | "section" | "article" | "li";
  padding?: CardPadding;
  /** Lifts to the Soft shadow on hover; use only when the whole card is clickable. */
  interactive?: boolean;
  /** "inset" is a well inside another card. */
  tone?: "surface" | "inset";
};

const paddings: Record<CardPadding, string> = { none: "", sm: "p-4", md: "p-5", lg: "p-6 max-sm:p-5" };

/** A white record card on the page wash: 16px corners, Border Soft, Resting shadow. */
export function Card({ as = "div", padding = "none", interactive = false, tone = "surface", className, children, ...props }: CardProps) {
  const Element = as as ElementType;
  return (
    <Element
      className={cn(
        "tanaw-card rounded-tanaw-lg border border-(--tanaw-border-soft)",
        tone === "surface" ? "bg-(--tanaw-surface) shadow-tanaw-resting" : "bg-(--tanaw-surface-inset)",
        interactive && "transition-[box-shadow,border-color,translate,scale] duration-200 ease-tanaw-out hover:-translate-y-px hover:border-(--tanaw-interactive-hover-border) hover:shadow-tanaw-soft motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        paddings[padding],
        className,
      )}
      {...props}
    >
      {children}
    </Element>
  );
}

export type CardHeaderProps = {
  title: ReactNode;
  /** A small uppercase label above the title. */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** An icon shown in an inset tile before the title. */
  icon?: ReactNode;
  /** Buttons or filters on the right. */
  actions?: ReactNode;
  /** h2 by default. */
  level?: 2 | 3 | 4;
  /** Draws a divider under the header. */
  divided?: boolean;
  className?: string;
};

/** The heading row of a card: optional icon, eyebrow, title, description and actions. */
export function CardHeader({ title, eyebrow, description, icon, actions, level = 2, divided = false, className }: CardHeaderProps) {
  const Heading = `h${level}` as ElementType;
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4", divided && "border-b border-(--tanaw-border-soft)", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-tanaw-md bg-(--tanaw-selected-bg) text-(--tanaw-accent-ink)">{icon}</span>}
        <div className="min-w-0">
          {eyebrow && <p className="mb-1 text-xs font-bold tracking-label text-(--tanaw-label) uppercase">{eyebrow}</p>}
          <Heading className="font-display text-lg leading-tight font-bold text-(--tanaw-text)">{title}</Heading>
          {description && <p className="mt-1 text-sm leading-relaxed text-(--tanaw-text-muted)">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A footer row for a card, usually actions aligned right. */
export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center justify-end gap-3 border-t border-(--tanaw-border-soft) px-5 py-4", className)}>{children}</div>;
}
