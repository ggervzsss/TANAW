/*
 * GENERATED FILE. Do not edit; change design-system/src/components/Checkbox.tsx instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: d2ee5b96816574a965560b1985a06b6307989c581a7de0e848e831becb58e008
 */
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size"> & {
  label: ReactNode;
  description?: ReactNode;
};

/** A checkbox with its label and optional description; checked state uses Civic Green. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, description, className, id, ...props }, ref) {
  const generated = useId();
  const inputId = id ?? generated;
  return (
    <label htmlFor={inputId} className={cn("tanaw-checkbox flex cursor-pointer items-start gap-3 has-disabled:cursor-not-allowed has-disabled:opacity-60", className)}>
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        aria-describedby={description ? `${inputId}-description` : undefined}
        className="mt-0.5 h-4.5 w-4.5 shrink-0 cursor-pointer rounded-[5px] border-(--tanaw-control-border) accent-(--tanaw-action) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) disabled:cursor-not-allowed"
        {...props}
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-(--tanaw-text)">{label}</span>
        {description && (
          <span id={`${inputId}-description`} className="mt-0.5 block text-xs leading-5 text-(--tanaw-text-muted)">
            {description}
          </span>
        )}
      </span>
    </label>
  );
});
