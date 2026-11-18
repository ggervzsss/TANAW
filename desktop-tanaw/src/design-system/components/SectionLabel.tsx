/*
 * GENERATED FILE. Do not edit; change design-system/src/components/SectionLabel.tsx instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: b5ca8b329752a1e0256d1b1d3143ac4b71722e3e24a8537788ba9fdc6008d72a
 */
import type { ElementType, ReactNode } from "react";
import { cn } from "../lib/cn";

export type SectionLabelProps = {
  children: ReactNode;
  /** "label" is Forest Label (figure names, table headers); "eyebrow" is Gold Ink over page titles. */
  tone?: "label" | "eyebrow" | "muted";
  as?: "p" | "span" | "h2" | "h3" | "dt";
  id?: string;
  className?: string;
};

const tones = {
  label: "text-(--tanaw-label)",
  eyebrow: "text-(--tanaw-gold-ink)",
  muted: "text-(--tanaw-text-muted)",
};

/** The small uppercase tracked label that names a figure, a column or a section. */
export function SectionLabel({ children, tone = "label", as = "p", id, className }: SectionLabelProps) {
  const Element = as as ElementType;
  return (
    <Element id={id} className={cn("text-xs leading-4 font-bold tracking-label uppercase", tones[tone], className)}>
      {children}
    </Element>
  );
}
