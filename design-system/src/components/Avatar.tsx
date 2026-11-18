import { cn } from "../lib/cn";
import { initialsOf } from "../lib/initials";

export type AvatarProps = {
  /** A person's or account's name; the first letters of up to two words are shown. */
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizes = { sm: "h-7 w-7 text-[0.6875rem]", md: "h-9 w-9 text-xs", lg: "h-12 w-12 text-sm" };

/** An initials circle for the signed-in account. */
export function Avatar({ name, size = "md", className }: AvatarProps) {
  return (
    <span aria-hidden="true" className={cn("tanaw-avatar inline-flex shrink-0 items-center justify-center rounded-full bg-(--tanaw-action) font-bold text-(--tanaw-on-action) ring-2 ring-white/40", sizes[size], className)}>
      {initialsOf(name) || "?"}
    </span>
  );
}
