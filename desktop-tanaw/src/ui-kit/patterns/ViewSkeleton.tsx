import type { ReactNode } from "react";
import { Skeleton } from "../components/Spinner";
import { cn } from "../lib/cn";

export type ViewSkeletonVariant = "dashboard" | "cameras" | "reports" | "list" | "help" | "settings";

export type ViewSkeletonProps = {
  /** Which page shape to sketch while its code or data loads. */
  variant?: ViewSkeletonVariant;
  /** Announced to screen readers, for example "Loading dashboard". */
  label?: string;
  className?: string;
};

/**
 * A whole-page loading placeholder in the shape of the page that is on its way: a heading, then
 * the page's own blocks. It waits a beat before showing, so fast loads never flash it.
 */
export function ViewSkeleton({ variant = "dashboard", label = "Loading view", className }: ViewSkeletonProps) {
  if (variant === "settings") return <SettingsSkeleton label={label} className={className} />;
  return (
    <div role="status" aria-label={label} aria-busy="true" className={cn("tanaw-skeleton-screen mx-auto w-full space-y-6 pt-1", variant === "list" && "max-w-290", variant === "help" && "max-w-300", className)}>
      <PageHeading />
      {variant === "dashboard" && <DashboardBody />}
      {variant === "cameras" && <CamerasBody />}
      {variant === "reports" && <ReportsBody />}
      {variant === "list" && <ListBody />}
      {variant === "help" && <HelpBody />}
    </div>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  // Pages are card-free, so their outlines are too: a section is a hairline and air, not a box.
  return <div className={cn("border-t border-(--tanaw-border-soft) py-5", className)}>{children}</div>;
}

function PageHeading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-3 w-28" shape="pill" />
      <Skeleton className="h-7 w-64 max-w-full" />
      <Skeleton className="h-4 w-md max-w-full" />
    </div>
  );
}

function ListRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y divide-(--tanaw-border-soft)">
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
          <Skeleton className="h-10 w-10 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4" style={{ width: `${72 - row * 9}%` }} />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-6 w-20 shrink-0" shape="pill" />
        </div>
      ))}
    </div>
  );
}

function DashboardBody() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Panel key={index} className="space-y-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-3 w-36 max-w-full" />
          </Panel>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-5 w-44" />
            <Skeleton className="h-8 w-32" shape="pill" />
          </div>
          <div className="flex h-56 items-end gap-3" aria-hidden="true">
            {[46, 68, 54, 82, 60, 74, 40, 88, 64, 52, 70, 58].map((height, index) => (
              <Skeleton key={index} className="flex-1" style={{ height: `${height}%`, borderEndStartRadius: 0, borderEndEndRadius: 0, animationDelay: `0ms, ${index * 60}ms` }} />
            ))}
          </div>
        </Panel>
        <Panel className="space-y-5">
          <Skeleton className="h-5 w-36" />
          <ListRows rows={3} />
        </Panel>
      </div>
    </>
  );
}

function CamerasBody() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
      <Panel className="space-y-5">
        <Skeleton className="h-10 w-full" />
        <ListRows rows={4} />
      </Panel>
      <Panel className="space-y-4">
        <Skeleton className="aspect-video w-full" />
        <div className="flex gap-3">
          <Skeleton className="h-10 w-32" />
          <Skeleton className="h-10 w-32" />
        </div>
      </Panel>
    </div>
  );
}

function ReportsBody() {
  return (
    <>
      <div className="flex gap-3">
        <Skeleton className="h-10 w-40" shape="pill" />
        <Skeleton className="h-10 w-36" shape="pill" />
      </div>
      <Panel className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-10 w-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </Panel>
    </>
  );
}

function ListBody() {
  return (
    <Panel>
      <ListRows rows={5} />
    </Panel>
  );
}

function HelpBody() {
  return (
    <>
      <div className="space-y-3">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-13 w-full max-w-3xl rounded-tanaw-md" />
      </div>
      <div className="grid gap-10 border-t border-(--tanaw-border-soft) pt-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <div className="divide-y divide-(--tanaw-border-soft)">
            {[74, 62, 70].map((width, row) => (
              <div key={row} className="space-y-2 py-4">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4" style={{ width: `${width}%` }} />
                <Skeleton className="h-3" style={{ width: `${width - 14}%` }} />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-4 w-28" />
          {Array.from({ length: 5 }, (_, row) => (
            <div key={row} className="flex h-11 items-center gap-3">
              <Skeleton className="h-8 w-8 shrink-0" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function SettingsSkeleton({ label, className }: { label: string; className?: string }) {
  const gutter = "px-[clamp(1.25rem,3vw,3rem)]";
  return (
    <div role="status" aria-label={label} aria-busy="true" className={cn("tanaw-skeleton-screen flex min-h-full flex-1 flex-col bg-(--tanaw-surface)", className)}>
      <div className={cn("flex flex-col gap-3 border-b border-(--tanaw-border-soft) bg-linear-to-b from-(--tanaw-selected-bg) to-(--tanaw-surface) pt-4 pb-6", gutter)}>
        <Skeleton className="h-4 w-16" shape="pill" />
        <Skeleton className="mt-1 h-8 w-64 max-w-full" />
        <Skeleton className="h-1 w-14" shape="pill" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid flex-1 min-[60rem]:grid-cols-[clamp(15rem,19%,18rem)_minmax(0,1fr)]">
        <div className={cn("space-y-2 border-(--tanaw-border-soft) py-6 max-[60rem]:border-b min-[60rem]:border-r", gutter, "min-[60rem]:pr-4")}>
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="flex h-11 items-center gap-3 px-3">
              <Skeleton className="h-4 w-4 shrink-0" />
              <Skeleton className="h-3.5" style={{ width: `${70 - index * 6}%` }} />
            </div>
          ))}
        </div>
        <div className={cn("space-y-7 py-8", gutter)}>
          <div className="space-y-2">
            <Skeleton className="h-6 w-52" />
            <Skeleton className="h-3.5 w-96 max-w-full" />
          </div>
          <div className="flex items-center gap-4 border-b border-(--tanaw-border-soft) pb-7">
            <Skeleton className="h-14 w-14 shrink-0" shape="circle" />
            <div className="space-y-2">
              <Skeleton className="h-4.5 w-40" />
              <Skeleton className="h-3.5 w-56" />
            </div>
          </div>
          <div className="grid gap-x-8 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="space-y-2 border-b border-(--tanaw-border-soft) py-3.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-4 w-40 max-w-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
