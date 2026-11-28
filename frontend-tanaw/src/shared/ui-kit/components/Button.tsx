import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "danger" | "destructive" | "ghost" | "link";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  children: ReactNode;
  /** primary: the one Civic Green action; secondary: a quiet tint; danger: a red tint for destructive actions; destructive: solid red, for the confirm button of a destructive confirmation; ghost: no fill until hovered; link: inline text. */
  variant?: ButtonVariant;
  /** sm 34px, md 42px (default), lg 48px; on touch screens sm and md are 44px. */
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
  "tanaw-button relative isolate inline-flex shrink-0 items-center justify-center gap-2 rounded-tanaw-md font-semibold tracking-[-0.006em] whitespace-nowrap transition-[background-color,border-color,color,box-shadow,translate,scale,opacity] duration-200 ease-tanaw-out select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) active:scale-[0.97] active:duration-100 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 motion-reduce:transition-none motion-reduce:active:scale-100";

/* Hover lifts a button by a pixel and pressing settles it back; the kit stylesheet (Controls.css) adds the
   light sweep across the primary button and the icon nudges. */
const lift = "enabled:hover:-translate-y-px enabled:active:translate-y-0 motion-reduce:enabled:hover:translate-y-0";

const variants: Record<ButtonVariant, string> = {
  primary: cn(
    "bg-(--tanaw-action) text-(--tanaw-on-action) shadow-[inset_0_1px_0_rgb(255_255_255/0.16),0_1px_2px_rgb(5_91_37/0.18)] enabled:hover:bg-(--tanaw-action-hover) enabled:hover:shadow-(--tanaw-button-lift)",
    lift,
  ),
  secondary: cn(
    "border border-transparent bg-(--tanaw-control-bg) text-(--tanaw-text) enabled:hover:border-(--tanaw-control-border) enabled:hover:bg-(--tanaw-control-bg-hover)",
    lift,
  ),
  danger: cn("border border-transparent bg-(--tanaw-tonal-danger) text-(--tanaw-danger) enabled:hover:bg-(--tanaw-tonal-danger-hover)", lift),
  destructive: cn(
    "bg-(--tanaw-danger-action) text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(127_29_29/0.2)] enabled:hover:bg-(--tanaw-danger-action-hover) enabled:hover:shadow-[0_8px_20px_-6px_rgb(180_35_24/0.45)]",
    lift,
  ),
  ghost: "text-(--tanaw-text-secondary) enabled:hover:bg-(--tanaw-control-bg) enabled:hover:text-(--tanaw-text)",
  link: "h-auto! px-0! text-(--tanaw-accent-ink) underline-offset-4 hover:underline active:scale-100",
};

/* On touch screens sm and md grow to 44px, so every button is an easy press. */
const sizes: Record<ButtonSize, string> = {
  sm: "h-8.5 px-3.5 text-[0.8125rem] pointer-coarse:h-11 pointer-coarse:px-4",
  md: "h-10.5 px-4.5 text-sm pointer-coarse:h-11",
  lg: "h-12 px-6 text-[0.9375rem]",
};

/**
 * The one TANAW button: 12px corners, sentence case, Civic Green only for the primary action. Secondary,
 * danger and ghost buttons are tonal (a soft tint, never a white box), so they sit on the page like the fields.
 */
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
