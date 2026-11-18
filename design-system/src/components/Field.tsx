import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type FieldProps = {
  label: ReactNode;
  /** One control: Input, Textarea, Select or any element that accepts id and aria-* props. */
  children: ReactElement<Record<string, unknown>>;
  /** Helper text under the control. */
  hint?: ReactNode;
  /** Validation message; also marks the control invalid. */
  error?: ReactNode;
  required?: boolean;
  /** Hides the label visually but keeps it for screen readers. */
  hideLabel?: boolean;
  /** Use a given id instead of a generated one. */
  id?: string;
  className?: string;
};

/** A label, one control and its helper or error text, wired together for assistive technology. */
export function Field({ label, children, hint, error, required = false, hideLabel = false, id, className }: FieldProps) {
  const generated = useId();
  const controlId = id ?? generated;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: controlId,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required || undefined,
        // Design-system controls take `invalid`; plain HTML elements rely on aria-invalid.
        ...(typeof children.type === "string" ? {} : { invalid: children.props.invalid ?? Boolean(error) }),
      })
    : children;
  return (
    <div className={cn("tanaw-field flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={controlId} className={cn("text-sm font-semibold text-(--tanaw-text)", hideLabel && "sr-only")}>
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-(--tanaw-error)">
            *
          </span>
        )}
      </label>
      {control}
      {hint && !error && (
        <p id={hintId} className="text-xs leading-5 text-(--tanaw-text-muted)">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs leading-5 font-semibold text-(--tanaw-error)">
          {error}
        </p>
      )}
    </div>
  );
}
