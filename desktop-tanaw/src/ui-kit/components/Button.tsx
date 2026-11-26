import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "link";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  /** primary: the one Civic Green action; secondary: outlined; danger: destructive; ghost: quiet; link: inline text. */
  variant?: ButtonVariant;
  /** sm 34px, md 42px (default), lg 48px. */
  size?: ButtonSize;
  /** Shows a spinner, keeps the width and blocks presses. */
  loading?: boolean;
  /** An icon before the label (lucide icons at 16px fit). */
  leadingIcon?: ReactNode;
  /** An icon after the label. */
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
};

const base =
  "tanaw-button inline-flex shrink-0 items-center justify-center gap-2 rounded-tanaw-md font-semibold whitespace-nowrap transition-[background-color,border-color,color,box-shadow,translate,scale,opacity] duration-150 ease-tanaw-out select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-(--tanaw-action) text-(--tanaw-on-action) shadow-tanaw-resting hover:bg-(--tanaw-action-hover) hover:shadow-[0_6px_16px_rgb(5_91_37/0.22)] disabled:hover:bg-(--tanaw-action) disabled:hover:shadow-tanaw-resting",
  secondary:
    "border border-(--tanaw-control-border) bg-(--tanaw-control-bg) text-(--tanaw-text) shadow-tanaw-resting hover:border-(--tanaw-control-border-hover) hover:bg-(--tanaw-control-hover) disabled:hover:bg-(--tanaw-control-bg)",
  danger: "border border-(--tanaw-danger-line) bg-(--tanaw-control-bg) text-(--tanaw-danger) shadow-tanaw-resting hover:bg-(--tanaw-danger-surface) disabled:hover:bg-(--tanaw-control-bg)",
  ghost: "text-(--tanaw-text-secondary) hover:bg-(--tanaw-control-hover) hover:text-(--tanaw-text)",
  link: "h-auto! px-0! text-(--tanaw-accent-ink) underline-offset-4 hover:underline active:scale-100",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8.5 px-3.5 text-[0.8125rem]",
  md: "h-10.5 px-4.5 text-sm",
  lg: "h-12 px-6 text-base",
};

/** The one TANAW button: 12px corners, sentence case, Civic Green only for the primary action. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, variant = "primary", size = "md", loading = false, leadingIcon, trailingIcon, fullWidth = false, className, disabled, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-variant={variant}
      className={cn(base, variants[variant], sizes[size], fullWidth && "w-full", className)}
      {...props}
    >
      {loading ? <Spinner size={size === "sm" ? 14 : 16} label="" /> : leadingIcon}
      <span className="min-w-0 truncate">{children}</span>
      {!loading && trailingIcon}
    </button>
  );
});
