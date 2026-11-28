import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/**
 * The shared field shell: a soft translucent tint with a faint hairline (never a white box), 12px corners.
 * Hover deepens the tint; focus lifts it to the surface colour with an accent edge and a soft halo.
 */
export const controlClassName =
  "tanaw-control w-full min-w-0 rounded-tanaw-md border border-(--tanaw-control-border) bg-(--tanaw-control-bg) text-sm text-(--tanaw-text) transition-[border-color,box-shadow,background-color] duration-200 ease-tanaw-out outline-none placeholder:text-(--tanaw-text-placeholder) hover:border-(--tanaw-control-border-hover) hover:bg-(--tanaw-control-bg-hover) focus:border-(--tanaw-accent-ink) focus:bg-(--tanaw-control-bg-focus) focus:shadow-(--tanaw-field-ring) disabled:cursor-not-allowed disabled:border-transparent disabled:bg-(--tanaw-control-disabled) disabled:text-(--tanaw-interactive-disabled-text) aria-invalid:border-(--tanaw-error) aria-invalid:focus:shadow-[0_0_0_4px_rgb(220_38_38/0.12)] motion-reduce:transition-none";

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  /** Marks the field invalid (red border); Field sets this from its error. */
  invalid?: boolean;
  /** An icon or text inside the field, before the value. */
  leading?: ReactNode;
  /** An icon or button inside the field, after the value. */
  trailing?: ReactNode;
  size?: "sm" | "md";
};

/** A text input, 44px tall (32px small, 44px on touch screens). Touch screens set its text at 16px (Controls.css) so iOS does not zoom in. */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid = false, leading, trailing, size = "md", className, ...props }, ref) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={cn(controlClassName, size === "sm" ? "h-8 px-2.5 text-xs pointer-coarse:h-11" : "h-11 px-3.5", Boolean(leading) && "pl-10", Boolean(trailing) && "pr-10 pointer-coarse:pr-12", leading || trailing ? undefined : className)}
      {...props}
    />
  );
  if (!leading && !trailing) return input;
  return (
    <span className={cn("tanaw-field relative flex min-w-0 items-center", className)}>
      {leading && <span className="tanaw-field-icon pointer-events-none absolute left-3.5 flex text-(--tanaw-text-muted)">{leading}</span>}
      {input}
      {trailing && <span className="absolute right-2 flex items-center">{trailing}</span>}
    </span>
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean };

/** A multi-line text field with the same shell as Input. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid = false, className, rows = 4, ...props }, ref) {
  return <textarea ref={ref} rows={rows} aria-invalid={invalid || props["aria-invalid"] || undefined} className={cn(controlClassName, "min-h-20 resize-y px-3 py-2.5 leading-relaxed", className)} {...props} />;
});
