/*
 * GENERATED FILE. Do not edit; change design-system/src/components/Avatar.tsx instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: 4dada6c92ac78720e3cb4d705eab8cdedfca31cd81ae4614f46d1d3f59e7d169
 */
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
