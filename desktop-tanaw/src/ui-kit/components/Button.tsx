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
  "tanaw-button inline-flex shrink-0 items-center justify-center gap-2 rounded-tanaw-md font-bold whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-150 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) disabled:cursor-not-allowed disabled:opacity-50 active:translate-y-px disabled:active:translate-y-0";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-(--tanaw-action) text-(--tanaw-on-action) shadow-tanaw-resting hover:bg-(--tanaw-action-hover) disabled:hover:bg-(--tanaw-action)",
  secondary:
    "border border-(--tanaw-control-border) bg-(--tanaw-control-bg) text-(--tanaw-text) shadow-tanaw-resting hover:border-(--tanaw-control-border-hover) hover:bg-(--tanaw-control-hover) disabled:hover:bg-(--tanaw-control-bg)",
  danger: "border border-(--tanaw-danger-line) bg-(--tanaw-control-bg) text-(--tanaw-danger) shadow-tanaw-resting hover:bg-(--tanaw-danger-surface) disabled:hover:bg-(--tanaw-control-bg)",
  ghost: "text-(--tanaw-text-secondary) hover:bg-(--tanaw-control-hover) hover:text-(--tanaw-text)",
  link: "h-auto! px-0! text-(--tanaw-accent-ink) underline-offset-4 hover:underline active:translate-y-0",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8.5 px-3 text-xs",
  md: "h-10.5 px-4 text-sm",
  lg: "h-12 px-5 text-base",
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
