import type { CSSProperties } from "react";
import { Skeleton } from "../components/Spinner";
import { cn } from "../lib/cn";

/**
 * The page shapes a whole-page skeleton can take:
 * - "page": a table page (title, optional figures, tabs and filters, a status line, table rows).
 * - "list": a list under a layout title (title signed by the civic line, a list bar, rows with a disc).
 * - "split": a list beside a detail pane (title, filters, status line, then the two panes).
 * - "detail": one record (back link, photo and title with tags, four figures, a chart beside a list).
 * - "dashboard": the map and its insights, then two recent lists.
 * - "settings": the General Settings frame (header band, section rail, a section).
 * - "help": the Help Center (title, search, categories beside the articles).
 */
export type ViewSkeletonVariant = "page" | "list" | "split" | "detail" | "dashboard" | "settings" | "help";

export type ViewSkeletonProps = {
  /** Which page shape to sketch while its code or data loads; see ViewSkeletonVariant. */
  variant?: ViewSkeletonVariant;
  /** A back link above the title. */
  back?: boolean;
  /** Lines of lede under the title (0, 1 or 2). */
  lede?: 0 | 1 | 2;
  /** What sits at the right of the title: a status line, a large button, a pill picker or a field. */
  action?: "text" | "button" | "pill" | "field";
  /** Figures in the strip under the title ("page" only; "detail" always has four). */
  figures?: number;
  /** Tabs under the title ("page" only). */
  tabs?: number;
  /** Fields in the filter row ("page" and "split"). */
  filters?: number;
  /** Whether the filter fields carry a label above them. */
  filterLabels?: boolean;
  /** "fill": the filters share the row, the search taking the larger part. "compact": a fixed-width search and selects at the start of the row. */
  filterWidths?: "fill" | "compact";
  /** Whether a one-line count or result sits under the filters ("page" only). */
  statusLine?: boolean;
  /** Rows in the list or table. */
  rows?: number;
  /** Announced to screen readers, for example "Loading TANAW workspace…". */
  label?: string;
  className?: string;
};

/**
 * A whole-page loading placeholder in the shape of the page that is on its way, built from the
 * same measures as the real page (the page title and lede, 44px fields, rows at their text's line
 * height), so nothing moves when it arrives. Pages are card-free, so the outline is too. It waits a
 * beat before showing, so fast loads never flash it.
 */
export function ViewSkeleton({
  variant = "page",
  back = false,
  lede = 1,
  action,
  figures = 0,
  tabs = 0,
  filters = 0,
  filterLabels = true,
  filterWidths = "fill",
  statusLine = true,
  rows,
  label = "Loading page",
  className,
}: ViewSkeletonProps) {
  const heading = { back, lede, action };
  return (
    <div role="status" aria-label={label} aria-busy="true" data-view-skeleton={variant} className={cn("tanaw-skeleton-screen w-full", className)}>
      <div aria-hidden="true">
        {variant === "page" && (
          <>
            <PageHeading {...heading} />
            {figures > 0 && <FigureStrip count={figures} />}
            {tabs > 0 && <TabsOutline count={tabs} className={figures > 0 ? "mt-6" : undefined} />}
            {filters > 0 && <FilterRow count={filters} labels={filterLabels} widths={filterWidths} className={figures > 0 || tabs > 0 ? "mt-6" : undefined} />}
            {filters > 0 && statusLine && <StatusLine />}
            <TableOutline rows={rows ?? 8} className={filters > 0 ? (statusLine ? "mt-3" : "mt-4") : tabs > 0 ? "mt-4" : figures > 0 ? "mt-6" : undefined} />
          </>
        )}
        {variant === "list" && <ListOutline rows={rows ?? 6} />}
        {variant === "split" && (
          <>
            <PageHeading {...heading} />
            {filters > 0 && <FilterRow count={filters} labels={filterLabels} widths={filterWidths} />}
            <StatusLine />
            <SplitOutline rows={rows ?? 5} />
          </>
        )}
        {variant === "detail" && <DetailOutline back={back} />}
        {variant === "dashboard" && <DashboardOutline lede={lede} />}
        {variant === "settings" && <SettingsOutline rows={rows ?? 3} />}
        {variant === "help" && <HelpOutline rows={rows ?? 6} />}
      </div>
    </div>
  );
}

/** A bar inside the box of the text line it stands for, so the outline is as tall as the text. */
function Line({ box, bar, className, style }: { box: string; bar: string; className?: string; style?: CSSProperties }) {
  return (
    <span className={cn("flex items-center", box, className)} style={style}>
      <Skeleton className={bar} />
    </span>
  );
}

/** 13px text at the page's 1.5 line height. */
const SMALL_LINE = "h-[19.5px]";

/** The page title (tanaw-page-title), its civic line and lede, with an optional back link and action, as PortalPageHeader lays them out. */
function PageHeading({ back, lede, action }: { back: boolean; lede: 0 | 1 | 2; action?: ViewSkeletonProps["action"] }) {
  return (
    <div className="mb-8 max-sm:mb-6">
      {back && <Line box="mb-4 min-h-8" bar="h-3.5 w-28" />}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0 flex-1">
          <TitleLines lede={lede} />
        </div>
        {action && <HeadingAction action={action} />}
      </div>
    </div>
  );
}

/** The title, civic line and lede lines; each bar sits in its line's own box (title 1.15, lede 1.55). */
function TitleLines({ lede, titleWidth = "w-72" }: { lede: 0 | 1 | 2; titleWidth?: string }) {
  return (
    <>
      <div className="tanaw-page-title">
        <Skeleton className={cn("inline-block h-[0.85em] max-w-full align-middle", titleWidth)} />
      </div>
      <Skeleton shape="pill" className="mt-3 h-1 w-14" />
      {lede > 0 && (
        <div className="tanaw-page-lede mt-3">
          <Skeleton className="inline-block h-[0.95em] w-xl max-w-full align-middle" />
          {lede > 1 && <Skeleton className="inline-block h-[0.95em] w-sm max-w-full align-middle" />}
        </div>
      )}
    </>
  );
}

function HeadingAction({ action }: { action: NonNullable<ViewSkeletonProps["action"]> }) {
  if (action === "text") return <Line box="h-5" bar="h-3.5 w-40" />;
  if (action === "button") return <Skeleton className="h-12 w-48 rounded-tanaw-md" />;
  if (action === "pill") return <Skeleton shape="pill" className="h-9 w-44" />;
  return <Skeleton className="h-11 w-56 rounded-tanaw-md max-sm:w-full" />;
}

/** Figures between hairlines: a label, a 36px count and a note per figure, one row (one column on phones). */
function FigureStrip({ count }: { count: number }) {
  return (
    <div
      className="grid grid-cols-(--figures) border-y border-(--tanaw-border-soft) max-md:grid-cols-1 [&>div+div]:border-l [&>div+div]:border-(--tanaw-border-soft) max-md:[&>div+div]:border-t max-md:[&>div+div]:border-l-0"
      style={{ "--figures": `repeat(${count}, minmax(0, 1fr))` } as CSSProperties}
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="min-w-0 px-6 py-4 first:pl-0 max-md:px-0">
          <Line box="h-5" bar="h-3.5 w-32" />
          <Skeleton className="mt-3 h-9 w-16" />
          <Line box={cn("mt-2", SMALL_LINE)} bar="h-3 w-48 max-w-full" />
        </div>
      ))}
    </div>
  );
}

/** A row of tabs on a hairline, at the tabs' own 45px height. */
function TabsOutline({ count, className }: { count: number; className?: string }) {
  return (
    <div className={cn("flex gap-1 border-b border-(--tanaw-border-soft)", className)}>
      {Array.from({ length: count }, (_, index) => (
        <Line key={index} box="h-11 px-4 pb-1" bar={index === 0 ? "h-3.5 w-24" : "h-3.5 w-20"} />
      ))}
    </div>
  );
}

/** The filter row: the search takes the larger share (or a fixed width when compact), then the selects; one column on phones. */
function FilterRow({ count, labels, widths = "fill", className }: { count: number; labels: boolean; widths?: "fill" | "compact"; className?: string }) {
  const columns = widths === "compact" ? `minmax(0, 22rem)${count > 1 ? ` repeat(${count - 1}, minmax(0, 13rem))` : ""}` : `minmax(0, 1.6fr)${count > 1 ? ` repeat(${count - 1}, minmax(0, 1fr))` : ""}`;
  return (
    <div className={cn("grid grid-cols-(--filters) items-end gap-3 max-md:grid-cols-1", className)} style={{ "--filters": columns } as CSSProperties}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className={cn("min-w-0", index > 0 && "max-md:hidden")}>
          {labels && <Line box={cn("mb-2", SMALL_LINE)} bar="h-3 w-20" />}
          <Skeleton className="h-11 w-full rounded-tanaw-md" />
        </div>
      ))}
    </div>
  );
}

/** The one-line count or result under the filters. */
function StatusLine() {
  return <Line box="mt-3 h-5" bar="h-3.5 w-40" />;
}

/** A card-free table: the heading row on a hairline, then rows of a two-line first cell and short cells. */
function TableOutline({ rows, className }: { rows: number; className?: string }) {
  const cols = "grid grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))] items-start gap-x-6 max-md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] max-md:[&>*:nth-child(n+3)]:hidden";
  return (
    <div className={className}>
      <div className={cn(cols, "border-b border-(--tanaw-border-soft) px-3 py-3")}>
        {[20, 16, 18, 14, 12].map((width, index) => (
          <Line key={index} box="h-4.5" bar="h-2.5" style={{ width: `${width * 4}px` }} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className={cn(cols, "border-b border-(--tanaw-border-soft) px-3 py-4")}>
          <span className="block min-w-0">
            <Line box="h-6" bar="h-4 max-w-full" style={{ width: `${[72, 58, 66, 50][row % 4]}%` }} />
            <Line box={cn("mt-0.5", SMALL_LINE)} bar="h-3 w-40 max-w-full" />
          </span>
          <Line box="h-6" bar="h-3.5 w-20" />
          <Line box="h-6" bar="h-3.5 w-16" />
          <Line box="h-6" bar="h-3.5 w-24" />
          <Line box="h-6" bar="h-3.5 w-14" />
        </div>
      ))}
    </div>
  );
}

/** A list under the layout's own title (no lede): the list bar between hairlines, then rows with a disc. */
function ListOutline({ rows }: { rows: number }) {
  return (
    <>
      <div className="mb-7 max-sm:mb-5">
        <div className="tanaw-page-title">
          <Skeleton className="inline-block h-[0.85em] w-56 max-w-full align-middle" />
        </div>
        <Skeleton shape="pill" className="mt-3 h-1 w-14" />
      </div>
      <div className="border-t border-(--tanaw-border-soft)">
        <div className="flex min-h-15 items-center justify-between gap-3 border-b border-(--tanaw-border-soft) py-3">
          <Line box="h-6" bar="h-4 w-36" />
          <Skeleton className="h-4 w-28" />
        </div>
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="border-b border-(--tanaw-border-soft) py-0.5 last:border-b-0">
            <div className="flex gap-3 px-4 py-4">
              <Skeleton className="mt-0.5 size-10 shrink-0" shape="circle" />
              <div className="min-w-0 flex-1">
                <Line box="h-[1.203rem]" bar="h-3.5" style={{ width: `${68 - (row % 4) * 9}%` }} />
                <Line box="mt-1 h-[1.32rem]" bar="h-3 w-11/12" />
                <Line box="mt-2 h-5" bar="h-3 w-32" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** The request list (a day heading and four-line rows) beside its detail pane, under one hairline. */
function SplitOutline({ rows }: { rows: number }) {
  return (
    <div className="mt-3 grid grid-cols-[26rem_minmax(0,1fr)] items-start gap-x-8 gap-y-6 border-t border-(--tanaw-border-soft) pt-3 max-[980px]:grid-cols-1">
      <div>
        <Line box="box-content h-5 px-3 pt-3 pb-1.5" bar="h-3 w-16" />
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="border-b border-(--tanaw-border-soft) px-3 py-3.5">
            <span className="flex h-5 items-center justify-between gap-3">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-12" />
            </span>
            <Line box="mt-1 h-5.5" bar="h-4 w-4/5" />
            <Line box="mt-0.5 h-5" bar="h-3.5 w-1/2" />
            <Line box="mt-2 h-5" bar="h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="py-1.5 max-[980px]:hidden">
        <Line box="h-5" bar="h-3 w-36" />
        <Line box="mt-2 h-7" bar="h-5.5 w-3/5" />
        <Line box="mt-2.5 h-5.5" bar="h-3.5 w-2/5" />
        <div className="mt-4.5 flex gap-2.5">
          <Skeleton className="h-11 w-32 rounded-tanaw-md" />
          <Skeleton className="h-11 w-36 rounded-tanaw-md" />
        </div>
        <Line box="mt-7 h-6" bar="h-4 w-32" />
        <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4 max-sm:grid-cols-1">
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className="block">
              <Line box={SMALL_LINE} bar="h-3 w-20" />
              <Line box="mt-1 h-5" bar="h-3.5 w-40 max-w-full" />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** One enterprise: back link, photo and title with its tags, four figures, then the trend beside the camera list. */
function DetailOutline({ back }: { back: boolean }) {
  return (
    <>
      <div className="mb-8 max-sm:mb-6">
        {back && <Line box="mb-4 min-h-8" bar="h-3.5 w-36" />}
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 items-start gap-5">
            <Skeleton className="h-28 w-42 shrink-0 rounded-tanaw-lg max-sm:hidden" />
            <div className="min-w-0">
              <TitleLines lede={1} />
              <span className="mt-3 flex gap-2">
                <Skeleton className="h-7 w-20" />
                <Skeleton className="h-7 w-28" />
                <Skeleton className="h-7 w-24" />
              </span>
            </div>
          </div>
          <Skeleton shape="pill" className="h-9 w-44" />
        </div>
      </div>
      <div className="mt-6 grid grid-cols-4 border-y border-(--tanaw-border-soft) max-[1100px]:grid-cols-2 max-sm:grid-cols-1 [&>div+div]:border-l [&>div+div]:border-(--tanaw-border-soft) max-[1100px]:[&>div:nth-child(3)]:border-l-0 max-sm:[&>div+div]:border-t max-sm:[&>div+div]:border-l-0">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="min-w-0 px-6 py-4 first:pl-0 max-[1100px]:nth-3:pl-0 max-sm:px-0">
            <Line box="h-5" bar="h-3.5 w-24" />
            <Line box={SMALL_LINE} bar="h-3 w-32" />
            <Skeleton className="mt-3 h-8.5 w-20" />
            <Line box={cn("mt-2", SMALL_LINE)} bar="h-3 w-28" />
          </div>
        ))}
      </div>
      <div className="mt-8 grid grid-cols-[minmax(0,1fr)_20rem] gap-x-10 gap-y-8 max-[1100px]:grid-cols-1">
        <div className="min-w-0">
          <SectionHeading title="w-40" caption="w-64" />
          <div className="mt-4">
            <span className="block h-5" />
            <div className="relative grid h-65 grid-rows-4">
              {[0, 1, 2, 3].map((index) => (
                <span key={index} className="border-t border-(--tanaw-chart-grid)" />
              ))}
              <Skeleton className="absolute right-2 bottom-7 left-14 h-[58%] rounded-t-tanaw-md rounded-b-none" />
            </div>
          </div>
        </div>
        <div className="border-l border-(--tanaw-border-soft) pl-10 max-[1100px]:border-t max-[1100px]:border-l-0 max-[1100px]:pt-6 max-[1100px]:pl-0">
          <SectionHeading title="w-44" caption="w-40" />
          <div className="mt-3">
            {[0, 1, 2].map((index) => (
              <span key={index} className="flex items-center justify-between gap-3 border-b border-(--tanaw-border-soft) py-3">
                <Line box="h-5" bar="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-20" />
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

/** A section heading (18px at 1.3) and its 13px caption. */
function SectionHeading({ title, caption }: { title: string; caption: string }) {
  return (
    <>
      <Line box="h-[23.4px]" bar={cn("h-4.5", title)} />
      <Line box={cn("mt-1", SMALL_LINE)} bar={cn("h-3 max-w-full", caption)} />
    </>
  );
}

/** Rows split by hairlines, each one 20px line with 12px above and below. */
function HairlineRows({ count, twoLines = false }: { count: number; twoLines?: boolean }) {
  return (
    <div>
      {Array.from({ length: count }, (_, row) => (
        <div key={row} className="border-t border-(--tanaw-border-soft) px-2 py-3 first:border-t-0">
          <span className="flex h-5 items-center justify-between gap-3">
            <Skeleton className="h-3.5" style={{ width: `${[64, 78, 52][row % 3]}%` }} />
            <Skeleton className="h-3.5 w-12 shrink-0" />
          </span>
          {twoLines && <Line box={cn("mt-1", SMALL_LINE)} bar="h-3 w-20" />}
        </div>
      ))}
    </div>
  );
}

/** The Admin Dashboard: the map beside Most Visited and Peak Occupancy, then Recent Activity beside Recent Requests. */
function DashboardOutline({ lede }: { lede: 0 | 1 | 2 }) {
  return (
    <>
      <PageHeading back={false} lede={lede} />
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-x-10 gap-y-8 max-[1100px]:grid-cols-1">
        <Skeleton className="aspect-720/400 min-h-72 w-full rounded-tanaw-xl" />
        <div className="flex min-w-0 flex-col gap-6 border-l border-(--tanaw-border-soft) pl-10 max-[1100px]:border-l-0 max-[1100px]:pl-0">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <SectionHeading title="w-32" caption="w-40" />
              </div>
              <Skeleton shape="pill" className="h-9 w-36" />
            </div>
            <Skeleton className="mt-4 h-10 w-full rounded-tanaw-md" />
            <div className="mt-3 space-y-1">
              {[72, 60, 48, 38, 30].map((width) => (
                <div key={width} className="grid min-h-9 grid-cols-[1.4rem_minmax(0,11rem)_minmax(0,1fr)_3.5rem] items-center gap-3 px-2 py-1">
                  <Skeleton className="h-3.5 w-3" />
                  <Skeleton className="h-3.5" />
                  <span className="block" style={{ width: `${width}%` }}>
                    <Skeleton shape="pill" className="h-2.5 w-full" />
                  </span>
                  <Skeleton className="ml-auto h-3.5 w-8" />
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-1 flex-col border-t border-(--tanaw-border-soft) pt-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <SectionHeading title="w-36" caption="w-48" />
              </div>
              <Skeleton shape="pill" className="h-9 w-40" />
            </div>
            <Line box="mt-3 mb-1 h-5" bar="h-3.5 w-36" />
            <div className="grid min-h-36 flex-1 grid-rows-3">
              {[0, 1, 2].map((index) => (
                <span key={index} className="border-t border-(--tanaw-border-soft)" />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-x-10 gap-y-8 border-t border-(--tanaw-border-soft) pt-6 max-[1100px]:grid-cols-1">
        {[false, true].map((twoLines) => (
          <div key={String(twoLines)} className={cn("min-w-0", twoLines && "border-l border-(--tanaw-border-soft) pl-10 max-[1100px]:border-l-0 max-[1100px]:pl-0")}>
            <div className="flex items-center justify-between gap-4">
              <Line box="h-[23.4px]" bar="h-4.5 w-36" />
              <Skeleton className="h-3.5 w-28" />
            </div>
            <Line box={cn("mt-1 mb-2", SMALL_LINE)} bar="h-3 w-56 max-w-full" />
            <HairlineRows count={3} twoLines={twoLines} />
          </div>
        ))}
      </div>
    </>
  );
}

/** General Settings: the washed header band (back, title, lede), the section rail, then a section. */
function SettingsOutline({ rows }: { rows: number }) {
  // Phones: 16px gutters and the sections as one row of pills, as on the settings page.
  const gutter = "px-[clamp(1.25rem,3vw,3rem)] max-sm:px-4";
  return (
    <div className="min-h-full bg-(--tanaw-surface)">
      <div className={cn("border-b border-(--tanaw-border-soft) pt-3 pb-[1.6rem] max-sm:pt-2 max-sm:pb-5", gutter)}>
        <Skeleton shape="pill" className="h-9 w-20" />
        <div className="mt-[0.35rem] font-display text-[clamp(1.75rem,1.2rem+1.4vw,2.25rem)] leading-[1.15]">
          <Skeleton className="inline-block h-[0.85em] w-64 max-w-full align-middle" />
        </div>
        <Skeleton shape="pill" className="mt-[0.6rem] h-1 w-14" />
        <Line box="mt-[0.6rem] h-[22.5px]" bar="h-3.5 w-80 max-w-full" />
      </div>
      <div className="grid min-[60rem]:grid-cols-[clamp(15rem,19%,18rem)_minmax(0,1fr)]">
        <div className={cn("grid content-start gap-1 border-b border-(--tanaw-border-soft) py-4 max-[60rem]:grid-cols-2 max-sm:flex max-sm:gap-1.5 max-sm:overflow-hidden max-sm:py-3 min-[60rem]:border-r min-[60rem]:border-b-0 min-[60rem]:py-[1.6rem] min-[60rem]:pr-4", gutter)}>
          {Array.from({ length: 3 }, (_, index) => (
            <span key={index} className="flex min-h-11 shrink-0 items-center gap-3 px-[0.85rem] py-2 max-sm:gap-2">
              <Skeleton className="size-5 shrink-0" />
              <Skeleton className="h-3.5 w-24" />
            </span>
          ))}
        </div>
        <div className="min-w-0">
          <div className={cn("pt-[1.9rem] pb-[0.4rem]", gutter)}>
            <Line box="h-7" bar="h-5 w-40" />
            <Line box="mt-[0.3rem] h-5.25" bar="h-3.5 w-80 max-w-full" />
          </div>
          <div className={cn("divide-y divide-(--tanaw-border-soft) pt-[0.6rem]", gutter)}>
            {Array.from({ length: rows }, (_, index) => (
              <div key={index} className="grid gap-4 py-7 sm:grid-cols-2">
                <div>
                  <Line box="h-5.25" bar="h-3.5 w-36" />
                  <Line box={cn("mt-1", SMALL_LINE)} bar="h-3 w-56 max-w-full" />
                </div>
                <Skeleton className="h-11 w-full rounded-tanaw-md" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The Help Center: kicker, title and lede, the search, then categories beside the articles. */
function HelpOutline({ rows }: { rows: number }) {
  return (
    <div className="mx-auto w-full max-w-300 pt-1 pb-12">
      <Line box="h-[18.2px]" bar="h-3 w-36" />
      <div className="mt-1 font-display text-[clamp(1.75rem,1.2rem+1.4vw,2.25rem)] leading-[1.15]">
        <Skeleton className="inline-block h-[0.85em] w-60 max-w-full align-middle" />
      </div>
      <Skeleton shape="pill" className="mt-3 h-1 w-14" />
      <Line box="mt-3 h-6" bar="h-3.5 w-xl max-w-full" />
      <div className="mt-8 max-w-184">
        <Line box="h-[23.8px]" bar="h-4 w-40" />
        <Skeleton className="mt-3 h-13 w-full rounded-tanaw-md" />
      </div>
      <div className="mt-10 grid gap-10 border-t border-(--tanaw-border-soft) pt-8 lg:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)] lg:items-start lg:gap-x-8">
        <div>
          <Line box="mb-2 h-[22.4px]" bar="h-4 w-24" />
          <div className="-mx-3 grid gap-0.5">
            {Array.from({ length: 5 }, (_, index) => (
              <span key={index} className="flex min-h-12 items-center gap-3 px-3 py-2">
                <Skeleton className="size-8 shrink-0" />
                <Skeleton className="h-3.5 w-32" />
              </span>
            ))}
          </div>
        </div>
        <div>
          <Line box="mb-2 h-[22.4px]" bar="h-4 w-36" />
          <div className="border-t border-(--tanaw-border-soft)">
            {Array.from({ length: rows }, (_, row) => (
              <div key={row} className="border-b border-(--tanaw-border-soft) py-4">
                <Line box="h-6" bar="h-4" style={{ width: `${62 - (row % 3) * 10}%` }} />
                <Line box="mt-1 h-5" bar="h-3.5 w-4/5" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
