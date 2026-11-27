import type { CSSProperties } from "react";
import "./Skeleton.css";
import { cn } from "../lib/cn";

export type SpinnerProps = {
  size?: number;
  /** Read by screen readers; pass "" when a parent already announces the busy state. */
  label?: string;
  className?: string;
};

/** A small rotating ring in the current text colour. */
export function Spinner({ size = 16, label = "Loading", className }: SpinnerProps) {
  return (
    <span role={label ? "status" : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true} className={cn("inline-flex shrink-0", className)}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="animate-spin motion-reduce:animate-none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export type SkeletonProps = {
  className?: string;
  label?: string;
  style?: CSSProperties;
  /** "block" (default) has soft 10px corners; "circle" and "pill" are fully round, for avatars, icons and badges. */
  shape?: "block" | "circle" | "pill";
};

/** A placeholder block in the shape of what is loading, with a soft sweep of light. */
export function Skeleton({ className, label, style, shape = "block" }: SkeletonProps) {
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={style}
      className={cn("tanaw-skeleton", shape !== "block" && `tanaw-skeleton--${shape}`, className ?? "h-4 w-24")}
    />
  );
}

export type SkeletonLineProps = { width: string; className?: string };

/**
 * A bar standing in for one line of text. It takes exactly the line box of the element it sits in
 * (its font size and line height), so a heading or caption keeps its height while it waits.
 */
export function SkeletonLine({ width, className }: SkeletonLineProps) {
  return <Skeleton className={cn("my-[0.2lh] inline-block h-[0.6lh] max-w-full align-top", className)} style={{ width }} />;
}

export type SkeletonTextProps = { lines?: number; className?: string };

/** Placeholder lines for a paragraph or a label and its value; the last line is shorter. */
export function SkeletonText({ lines = 2, className }: SkeletonTextProps) {
  return (
    <span aria-hidden="true" className={cn("tanaw-skeleton-text", className)}>
      {Array.from({ length: lines }, (_, line) => (
        <span key={line} className="tanaw-skeleton" />
      ))}
    </span>
  );
}
