import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

export type IconButtonVariant = "secondary" | "ghost" | "danger" | "glass";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & {
  /** Required: the button has no visible text. */
  label: string;
  icon: ReactNode;
  variant?: IconButtonVariant;
  size?: "sm" | "md";
};

const variants: Record<IconButtonVariant, string> = {
  secondary: "border border-(--tanaw-control-border) bg-(--tanaw-control-bg) text-(--tanaw-text-secondary) hover:bg-(--tanaw-control-hover) hover:text-(--tanaw-text)",
  ghost: "text-(--tanaw-text-muted) hover:bg-(--tanaw-control-hover) hover:text-(--tanaw-text)",
  danger: "border border-(--tanaw-danger-line) bg-(--tanaw-control-bg) text-(--tanaw-danger) hover:bg-(--tanaw-danger-surface)",
  glass: "border border-white/20 bg-white/10 text-white backdrop-blur-md hover:bg-white/20",
};

/** A square or round button with only an icon; always labelled for screen readers. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ label, icon, variant = "ghost", size = "md", className, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "tanaw-icon-button inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 w-8" : "h-10 w-10",
        variants[variant],
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  );
});
