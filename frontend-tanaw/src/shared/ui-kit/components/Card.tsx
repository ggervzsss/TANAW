import type { ElementType, HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export type CardPadding = "none" | "sm" | "md" | "lg";

export type CardProps = HTMLAttributes<HTMLElement> & {
  /** The element to render: div (default), section, article or li. */
  as?: "div" | "section" | "article" | "li";
  padding?: CardPadding;
  /** Tints on hover; use only when the whole section is clickable. */
  interactive?: boolean;
  /** "inset" is a quiet tinted well inside a section. */
  tone?: "surface" | "inset";
};

const paddings: Record<CardPadding, string> = { none: "", sm: "p-4", md: "p-5", lg: "p-6 max-sm:p-5" };

/**
 * A page section. Pages are open, not boxed (DESIGN.md, Default UI style): a section sits on the page
 * surface and is set apart by a hairline above it and air, with no border, fill and shadow tile.
 * The name stays Card so existing screens keep working.
 */
export function Card({ as = "div", padding = "none", interactive = false, tone = "surface", className, children, ...props }: CardProps) {
  const Element = as as ElementType;
  return (
    <Element
      className={cn(
        "tanaw-card",
        tone === "surface" ? "border-t border-(--tanaw-border-soft)" : "rounded-tanaw-md bg-(--tanaw-surface-inset)",
        interactive && "rounded-tanaw-md transition-colors duration-150 ease-tanaw-out hover:bg-(--tanaw-control-hover) motion-reduce:transition-none",
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
  /** A short sentence-case label above the title. */
  eyebrow?: ReactNode;
  description?: ReactNode;
  /** An icon shown in a soft green circle before the title. */
  icon?: ReactNode;
  /** Buttons or filters on the right. */
  actions?: ReactNode;
  /** h2 by default. */
  level?: 2 | 3 | 4;
  /** Draws a hairline under the header. */
  divided?: boolean;
  className?: string;
};

/** The heading row of a section: optional icon, label, title, description and actions. */
export function CardHeader({ title, eyebrow, description, icon, actions, level = 2, divided = false, className }: CardHeaderProps) {
  const Heading = `h${level}` as ElementType;
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4", divided && "border-b border-(--tanaw-border-soft)", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-(--tanaw-selected-bg) text-(--tanaw-accent-ink)">{icon}</span>}
        <div className="min-w-0">
          {eyebrow && <p className="mb-1 text-[0.8125rem] font-semibold text-(--tanaw-accent-ink)">{eyebrow}</p>}
          <Heading className="font-sans text-[1.0625rem] leading-snug font-[650] tracking-[-0.005em] text-(--tanaw-text)">{title}</Heading>
          {description && <p className="mt-1 text-sm leading-relaxed text-(--tanaw-text-muted)">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A footer row for a section, usually actions aligned right. */
export function CardFooter({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center justify-end gap-3 border-t border-(--tanaw-border-soft) px-5 py-4", className)}>{children}</div>;
}
