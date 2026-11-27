import { Skeleton } from "../components/Spinner";
import { cn } from "../lib/cn";

export type ViewSkeletonVariant = "page" | "list" | "detail";

export type ViewSkeletonProps = {
  /** Which page shape to sketch while its code or data loads: "page" (default) has a metric strip and rows. */
  variant?: ViewSkeletonVariant;
  /** Announced to screen readers, for example "Loading TANAW workspace…". */
  label?: string;
  className?: string;
};

/**
 * A whole-page loading placeholder in the shape of a typical portal page: a title with its civic
 * line, a metric strip, then rows split by hairlines. Pages are card-free, so the outline is too.
 * It waits a beat before showing, so fast loads never flash it.
 */
export function ViewSkeleton({ variant = "page", label = "Loading page", className }: ViewSkeletonProps) {
  return (
    <div role="status" aria-label={label} aria-busy="true" data-view-skeleton={variant} className={cn("tanaw-skeleton-screen w-full space-y-8 pt-1", className)}>
      <PageHeading />
      {variant === "page" && <MetricsOutline />}
      {variant === "detail" && <DetailOutline />}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-11 w-full max-w-sm" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28" shape="pill" />
            <Skeleton className="h-9 w-24" shape="pill" />
          </div>
        </div>
        <ListRows rows={variant === "list" ? 6 : 4} />
      </div>
    </div>
  );
}

function PageHeading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-9 w-72 max-w-full" />
      <Skeleton className="h-1 w-14" shape="pill" />
      <Skeleton className="h-4 w-md max-w-full" />
    </div>
  );
}

function MetricsOutline() {
  return (
    <div className="grid grid-cols-2 border-y border-(--tanaw-border-soft) py-6 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className={cn("space-y-3 px-6 max-lg:py-2", index > 0 && "lg:border-l lg:border-(--tanaw-border-soft)", index === 0 && "pl-0")}>
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-3 w-36 max-w-full" />
        </div>
      ))}
    </div>
  );
}

function DetailOutline() {
  return (
    <div className="grid gap-x-10 gap-y-5 border-y border-(--tanaw-border-soft) py-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-44 max-w-full" />
        </div>
      ))}
    </div>
  );
}

function ListRows({ rows }: { rows: number }) {
  return (
    <div className="divide-y divide-(--tanaw-border-soft) border-t border-(--tanaw-border-soft)">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4 py-4">
          <Skeleton className="h-10 w-10 shrink-0" shape="circle" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4" style={{ width: `${72 - (row % 4) * 9}%` }} />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-6 w-20 shrink-0 max-sm:hidden" shape="pill" />
        </div>
      ))}
    </div>
  );
}
