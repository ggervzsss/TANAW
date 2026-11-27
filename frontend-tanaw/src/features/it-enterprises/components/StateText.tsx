import type { ReactNode } from "react";
import { cn } from "@/shared/ui-kit";
import type { Tone } from "../model/enterprises";
import { toneDot, toneText } from "./tones";

/** A bold state word in its tone, with an optional dot before it. */
export function StateText({ tone, dot = false, children, className }: { tone: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-semibold", toneText[tone], className)}>
      {dot && <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", toneDot[tone])} />}
      {children}
    </span>
  );
}

/** A section heading: Inter 650, as on the desktop app. */
export function SectionHeading({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h2 id={id} className="text-lg leading-snug font-[650] tracking-[-0.01em] text-(--tanaw-text)">
      {children}
    </h2>
  );
}

/** A label over a field, in the portal's form style. */
export function FieldLabel({ htmlFor, children, optional = false }: { htmlFor?: string; children: ReactNode; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-(--tanaw-text-secondary)">
      {children}
      {optional && <span className="font-normal text-(--tanaw-text-muted)"> (optional)</span>}
    </label>
  );
}

/** A validation message under a field. */
export function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} className="mt-1.5 text-[13px] font-medium text-(--tanaw-error)">
      {children}
    </p>
  );
}
