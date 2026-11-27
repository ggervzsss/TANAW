import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";
import { visiblePages } from "../lib/pagination";

export type PaginationProps = {
  /** 1-based current page. */
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
  /** The left-hand summary, such as "Showing 1–8 of 42". */
  summary?: string;
  ariaLabel?: string;
  className?: string;
};

/* Quiet controls: no outline, a soft tint on hover, and the current page in the green tint. */
const buttonClass =
  "inline-flex h-10 min-w-10 items-center justify-center gap-1 rounded-tanaw-md px-3 text-sm font-semibold text-(--tanaw-text-secondary) transition-[background-color,color,scale] duration-200 ease-tanaw-out hover:bg-(--tanaw-control-bg) hover:text-(--tanaw-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:active:scale-100 motion-reduce:transition-none";

/** Previous / numbered pages / Next, with the summary on the left. */
export function Pagination({ page, pageCount, onChange, summary, ariaLabel = "Pagination", className }: PaginationProps) {
  const lastPage = Math.max(1, pageCount);
  return (
    <nav aria-label={ariaLabel} className={cn("mt-4 flex flex-wrap items-center justify-between gap-3", className)}>
      <p className="text-[0.8125rem] text-(--tanaw-text-muted) tabular-nums" role="status">
        {summary}
      </p>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className={buttonClass} disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft size={16} aria-hidden="true" /> Previous
        </button>
        {visiblePages(page, lastPage).map((value, index) =>
          value === "gap" ? (
            <span key={`gap-${index}`} className="px-1 text-(--tanaw-text-muted)" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={value}
              type="button"
              aria-current={value === page ? "page" : undefined}
              aria-label={`Page ${value}`}
              onClick={() => onChange(value)}
              className={cn(buttonClass, "tabular-nums", value === page && "bg-(--tanaw-selected-bg) text-(--tanaw-accent-ink) hover:bg-(--tanaw-selected-bg) hover:text-(--tanaw-accent-ink)")}
            >
              {value}
            </button>
          ),
        )}
        <button type="button" className={buttonClass} disabled={page >= lastPage} onClick={() => onChange(page + 1)}>
          Next <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}
