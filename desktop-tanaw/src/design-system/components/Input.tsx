/*
 * GENERATED FILE. Do not edit; change design-system/src/components/Input.tsx instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: dd8c38f8f9397c168eed2d1110464eb3313b75052fd4d92630bc8f5a61c78976
 */
import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/** The shared control shell: white fill, Control Border, 12px corners, green focus ring. */
export const controlClassName =
  "tanaw-control w-full min-w-0 rounded-tanaw-md border border-(--tanaw-control-border) bg-(--tanaw-control-bg) text-sm text-(--tanaw-text) shadow-tanaw-resting transition-[border-color,box-shadow,background-color] duration-150 outline-none placeholder:text-(--tanaw-text-placeholder) hover:border-(--tanaw-control-border-hover) focus:border-(--tanaw-accent-ink) focus:ring-4 focus:ring-emerald-600/15 disabled:cursor-not-allowed disabled:bg-(--tanaw-control-disabled) disabled:text-(--tanaw-interactive-disabled-text) aria-invalid:border-(--tanaw-error) aria-invalid:focus:ring-red-500/15";

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  /** Marks the field invalid (red border); Field sets this from its error. */
  invalid?: boolean;
  /** An icon or text inside the field, before the value. */
  leading?: ReactNode;
  /** An icon or button inside the field, after the value. */
  trailing?: ReactNode;
  size?: "sm" | "md";
};

/** A text input, 40px tall (32px small). */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid = false, leading, trailing, size = "md", className, ...props }, ref) {
  const input = (
    <input
      ref={ref}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={cn(controlClassName, size === "sm" ? "h-8 px-2.5 text-xs" : "h-10 px-3", Boolean(leading) && "pl-9", Boolean(trailing) && "pr-10", leading || trailing ? undefined : className)}
      {...props}
    />
  );
  if (!leading && !trailing) return input;
  return (
    <span className={cn("relative flex min-w-0 items-center", className)}>
      {leading && <span className="pointer-events-none absolute left-3 flex text-(--tanaw-text-muted)">{leading}</span>}
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
