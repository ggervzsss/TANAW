import { ArrowLeft, ChevronDown, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useEffectEvent, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/app/store/authStore";
import { useAdminRequests, useRequestDetail, useRequestReadMarks } from "@/features/alerts-monitor/hooks";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import type { Request } from "@/shared/services/requests";
import { Alert, Button, PortalPageHeader, SearchField, Select, Skeleton, cn } from "@/shared/ui-kit";
import { ITRequestDetail, ITRequestTable } from "../components";
import { useScrollEdges, useStartRequest } from "../hooks";
import {
  REQUEST_PARAM,
  activeFilterCount,
  defaultFilters,
  filterItRequests,
  filtersToParams,
  findSelectedRequest,
  formatReceived,
  formatWhen,
  parseFilters,
  statusFilterOptions,
  typeFilterOptions,
  typeFromSlug,
  typeSlug,
  type ItRequestFilters,
  type StatusFilter,
  type Viewer,
} from "../model";

/** Below this width the table and the request are two screens: the table, then the request with a Back. */
const NARROW_QUERY = "(max-width: 980px)";
/**
 * Wide windows tall enough for it: the page fits under the topbar and only the table (and the open
 * request beside it) scroll. Shorter windows scroll the page as a whole, so the table keeps room.
 */
const FIT_QUERY = "(min-width: 981px) and (min-height: 600px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
/** How long the request beside the table takes to slide out; it stays drawn until then. */
const PANEL_EXIT_MS = 260;
const filterLabelText = "block text-[13px] font-medium text-(--tanaw-text-secondary)";
const filterLabel = `mb-1.5 ${filterLabelText}`;

/**
 * Marks a request opened from the table, so closing it steps Back to the table where it was. It
 * keeps the table's address from then: if the filters changed since, closing stays on this entry.
 */
type ListState = { fromRequestList?: boolean; listSearch?: string } | null;

/** The address's query without the open request: the table's own view. */
function listSearchOf(params: URLSearchParams) {
  const next = new URLSearchParams(params);
  next.delete(REQUEST_PARAM);
  return next.toString();
}

/**
 * IT Requests (`/it/requests`), IT's first screen: help and approval requests from enterprises and
 * the sign-in page, as a table. Only IT changes a request's status; the Admin can add notes. The
 * filters and the open request (`?request=<id>`) live in the address. With nothing open the table
 * takes the full width; opening a row narrows it and shows the request on the right, with a close
 * button (Escape or the browser's Back also close it). On narrow screens the table comes first, and
 * a request opens as its own screen with a Back to the table. On wide windows the page fits under
 * the topbar: the title and filters stay put, and the table and the request scroll on their own.
 */
export function ITRequestsPage() {
  const { dateFormat, timeFormat } = useSystemDisplayPreferences();
  const user = useAuthStore((state) => state.user);
  const viewer: Viewer = useMemo(() => ({ id: user?.id ?? null, name: user?.displayName ?? null }), [user?.displayName, user?.id]);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const narrow = useMediaQuery(NARROW_QUERY);
  const reduceMotion = useMediaQuery(REDUCED_MOTION_QUERY);
  const fit = useMediaQuery(FIT_QUERY);
  const now = useMinuteClock();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const listScroll = useRef<number | null>(null);
  const filtersId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { requests, isLoading, isError, retry } = useAdminRequests();
  const { start, startingId } = useStartRequest();

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const visible = useMemo(() => filterItRequests(requests, filters), [filters, requests]);
  // Only a request someone opened (a row click or a link) is shown, and only it counts as read.
  const selected = useMemo(() => findSelectedRequest(requests, searchParams), [requests, searchParams]);
  const requestOpen = searchParams.has(REQUEST_PARAM);
  const linkMissing = requestOpen && !selected && !isLoading && !isError;
  const requestScreen = narrow && requestOpen;
  // Beside the table, a closed request stays drawn while it slides out.
  const shown = useLingering(selected, narrow || reduceMotion ? 0 : PANEL_EXIT_MS);
  const panelOpen = !narrow && requestOpen;
  const detailQuery = useRequestDetail(shown);
  useRequestReadMarks(selected, !isLoading);
  // While the page fits the window, the table and the request fade an edge that has more past it.
  useScrollEdges(tableRef, fit);
  useScrollEdges(panelRef, fit && panelOpen);

  const activeFilters = activeFilterCount(filters);
  const updateFilters = (patch: Partial<ItRequestFilters>) => setSearchParams(filtersToParams({ ...filters, ...patch }, searchParams), { replace: true, state: location.state });
  const resetFilters = () => setSearchParams(filtersToParams(defaultFilters, searchParams), { replace: true, state: location.state });
  const showEveryRequest = () => setSearchParams(filtersToParams({ ...defaultFilters, status: "all" }, searchParams), { replace: true, state: location.state });

  const select = (request: Request) => {
    const next = new URLSearchParams(searchParams);
    next.set(REQUEST_PARAM, request.id);
    // Another request while one is open replaces it, so Back (or closing) still returns to the table.
    if (requestOpen) {
      setSearchParams(next, { replace: true, state: location.state });
      return;
    }
    if (narrow) listScroll.current = scrollerOf(rootRef.current).scrollTop;
    setSearchParams(next, { state: { fromRequestList: true, listSearch: listSearchOf(searchParams) } satisfies ListState });
  };

  const closeRequest = () => {
    const state = location.state as ListState;
    const listSearch = listSearchOf(searchParams);
    if (state?.fromRequestList && (state.listSearch === undefined || state.listSearch === listSearch)) {
      navigate(-1);
      return;
    }
    setSearchParams(new URLSearchParams(listSearch), { replace: true });
  };

  // Moving between the table and a request screen: a request starts at its top, and the table comes
  // back where it was left.
  useLayoutEffect(() => {
    if (!narrow) return;
    const scroller = scrollerOf(rootRef.current);
    if (requestScreen) scroller.scrollTop = 0;
    else if (listScroll.current !== null) {
      scroller.scrollTop = listScroll.current;
      listScroll.current = null;
    }
  }, [narrow, requestScreen]);

  // Another request beside the table starts at its top.
  const shownId = shown?.id ?? null;
  useLayoutEffect(() => {
    if (panelRef.current && shownId) panelRef.current.scrollTop = 0;
  }, [shownId]);

  // Escape closes the request beside the table, unless a menu or dialog is open or a field is being typed in.
  const onEscape = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
    if (document.querySelector("[role='menu'], [role='listbox'], [role='dialog'], [aria-modal='true']")) return;
    closeRequest();
  });
  useEffect(() => {
    if (!panelOpen) return;
    const onKeyDown = (event: KeyboardEvent) => onEscape(event);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [panelOpen]);

  // When the request beside the table closes, focus goes back to its row.
  const lastOpenId = useRef<string | null>(null);
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    const closedId = lastOpenId.current;
    lastOpenId.current = selectedId;
    if (narrow || selectedId || !closedId) return;
    const panel = panelRef.current;
    if (panel && document.activeElement && document.activeElement !== document.body && !panel.contains(document.activeElement)) return;
    document.querySelector<HTMLElement>(`[data-request-row="${CSS.escape(closedId)}"] [data-row-primary]`)?.focus({ preventScroll: true });
  }, [narrow, selectedId]);

  const filterSummary = [statusFilterOptions.find(([value]) => value === filters.status)?.[1], typeFilterOptions.find(([value]) => value === typeSlug(filters.type))?.[1]].filter(Boolean).join(" · ");

  // After an action the request may leave the filtered table (resolved under "Open"): keep it open.
  const keepSelected = (request: Request) =>
    setSearchParams(
      (current) => {
        if (current.get(REQUEST_PARAM)) return current;
        const next = new URLSearchParams(current);
        next.set(REQUEST_PARAM, request.id);
        return next;
      },
      { replace: true, state: location.state },
    );

  const when = (value: string) => formatWhen(value, now, dateFormat, timeFormat);
  const received = (value: string) => formatReceived(value, now, dateFormat, timeFormat);
  const missingAlert = linkMissing && <Alert tone="warning" className="mb-4" title="That request is not in the list. It may have been withdrawn." />;

  const renderDetail = (request: Request, onClose?: () => void) => (
    <ITRequestDetail
      key={request.id}
      request={request}
      detail={detailQuery.data ?? null}
      detailLoading={detailQuery.isLoading}
      viewer={viewer}
      now={now}
      formatWhen={when}
      onActed={keepSelected}
      onClose={onClose}
    />
  );

  if (requestScreen) {
    return (
      <div ref={rootRef} className="w-full pb-14">
        <h1 className="sr-only">Requests</h1>
        <button
          type="button"
          onClick={closeRequest}
          className="group rounded-tanaw-sm -ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold text-(--tanaw-text-secondary) transition-colors duration-150 hover:text-(--tanaw-accent-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
        >
          <ArrowLeft size={16} aria-hidden="true" className="ease-tanaw-out transition-transform duration-150 group-hover:-translate-x-0.5 motion-reduce:transition-none" />
          Requests
        </button>
        <div className="mt-2 min-w-0">
          {missingAlert}
          {selected ? renderDetail(selected) : isLoading ? <DetailSkeleton /> : null}
        </div>
      </div>
    );
  }

  return (
    // data-fit-viewport asks the portal shell to fit the page under the topbar (AccountLayout).
    <div ref={rootRef} data-fit-viewport={fit || undefined} className={cn("w-full", fit ? "flex min-h-0 flex-1 flex-col" : "pb-14")}>
      <PortalPageHeader title="Requests" description="Help and approval requests from enterprises and the sign-in page. Only IT changes a request's status. Admin can add notes." />

      {/* A long search, then Type and Status at the right end; tablets give the search its own row. */}
      <div className="flex flex-wrap items-end gap-3 max-sm:grid max-sm:grid-cols-1">
        <div className="min-w-64 flex-1 max-lg:basis-full max-sm:min-w-0">
          <label htmlFor="it-requests-search" className={filterLabel}>
            Search
          </label>
          <SearchField id="it-requests-search" label="Search" value={filters.query} onChange={(query) => updateFilters({ query })} placeholder="Place, request or reference number" />
        </div>
        {/* On phones the filters fold under one row that says what they are set to. */}
        <button
          type="button"
          aria-expanded={filtersOpen}
          aria-controls={filtersId}
          onClick={() => setFiltersOpen((open) => !open)}
          className="rounded-tanaw-md ease-tanaw-out flex min-h-11 w-full cursor-pointer items-center gap-2.5 bg-(--tanaw-control-bg) px-3.5 text-left text-sm transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) active:bg-(--tanaw-control-bg-hover) sm:hidden"
        >
          <SlidersHorizontal size={16} aria-hidden="true" className="shrink-0 text-(--tanaw-text-secondary)" />
          <span className="font-semibold text-(--tanaw-text)">Filters</span>
          {activeFilters > 0 && <span className="rounded-full bg-(--tanaw-selected-bg) px-2 py-0.5 text-xs font-semibold text-(--tanaw-accent-ink) tabular-nums">{activeFilters}</span>}
          <span className="min-w-0 flex-1 truncate text-right text-[13px] text-(--tanaw-text-secondary)">{filterSummary}</span>
          <ChevronDown
            size={16}
            aria-hidden="true"
            className={cn("ease-tanaw-out shrink-0 text-(--tanaw-text-muted) transition-transform duration-200 motion-reduce:transition-none", filtersOpen && "rotate-180")}
          />
        </button>
        <div id={filtersId} className={cn("contents", !filtersOpen && "max-sm:hidden")}>
          <FilterSelect
            label="Type"
            className="w-64 max-lg:w-auto max-lg:flex-1"
            value={typeSlug(filters.type)}
            options={typeFilterOptions}
            onChange={(value) => updateFilters({ type: typeFromSlug(value) })}
          />
          <FilterSelect
            label="Status"
            className="w-48 max-lg:w-auto max-lg:flex-1"
            value={filters.status}
            options={statusFilterOptions}
            onChange={(value) => updateFilters({ status: value as StatusFilter })}
            // Clear filters rides on the label line at the row's right end, so it never pushes the row about.
            labelAction={
              activeFilters > 0 && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="rounded-tanaw-sm -my-1 inline-flex cursor-pointer items-center gap-1 py-1 text-[13px] font-semibold whitespace-nowrap text-(--tanaw-accent-ink) underline-offset-3 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring) max-sm:hidden"
                >
                  <X size={14} aria-hidden="true" />
                  Clear filters
                </button>
              )
            }
          />
        </div>
        {activeFilters > 0 && (
          <Button variant="ghost" className="h-11 w-full sm:hidden" leadingIcon={<X size={15} aria-hidden="true" />} onClick={resetFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {isError && (
        <Alert
          tone="danger"
          className="mt-4"
          title="Requests could not be loaded."
          action={
            <Button variant="secondary" size="sm" onClick={retry}>
              Try again
            </Button>
          }
        />
      )}

      <div className="it-requests__split mt-4" data-open={panelOpen || undefined} data-fit={fit || undefined}>
        <div ref={tableRef} className="it-requests__table-pane">
          {isLoading ? (
            <TableSkeleton />
          ) : (
            <ITRequestTable
              requests={visible}
              selectedId={panelOpen ? (selected?.id ?? null) : null}
              compact={!narrow && Boolean(shown)}
              viewer={viewer}
              formatReceived={received}
              onSelect={select}
              onStart={start}
              startingId={startingId}
              empty={<TableEmptyState filtered={activeFilters > 0} hasRequests={requests.length > 0} onReset={resetFilters} onShowAll={showEveryRequest} />}
            />
          )}
        </div>
        {!narrow && (
          <aside ref={panelRef} aria-label="Request details" className="it-requests__panel">
            {panelOpen && missingAlert}
            {panelOpen && linkMissing && (
              <Button variant="secondary" size="sm" onClick={closeRequest}>
                Close
              </Button>
            )}
            {shown ? renderDetail(shown, closeRequest) : panelOpen && isLoading && <DetailSkeleton />}
          </aside>
        )}
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
  className,
  labelAction,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
  className?: string;
  /** A small action at the end of the label line. */
  labelAction?: ReactNode;
}) {
  return (
    <div className={cn("max-w-full min-w-0 max-sm:w-full", className)}>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span aria-hidden="true" className={filterLabelText}>
          {label}
        </span>
        {labelAction}
      </div>
      <Select ariaLabel={label} value={value} options={options} onChange={onChange} />
    </div>
  );
}

/**
 * The table's shape while the requests load: the column names over a hairline, then rows with the
 * title and type, the place, the time, the status and a button, each bar in its line's own height.
 */
function TableSkeleton() {
  return (
    <div role="status" aria-label="Loading requests">
      <div className="flex h-10.5 items-end gap-6 border-b border-(--tanaw-border) px-3 pb-3 max-sm:hidden">
        {[20, 14, 16, 14, 18].map((width, index) => (
          <Skeleton key={index} className="h-2.5" style={{ width: `${width * 4}px`, marginRight: index === 0 ? "18%" : undefined }} />
        ))}
      </div>
      {[72, 58, 66, 50, 62, 54].map((width, index) => (
        <div
          key={index}
          className="grid grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-x-6 border-b border-(--tanaw-border-soft) px-3 py-3.5 max-sm:grid-cols-1 max-sm:px-0"
        >
          <span className="block min-w-0">
            <span className="flex h-5.5 items-center">
              <Skeleton className="h-4" style={{ width: `${width}%` }} />
            </span>
            <span className="mt-0.5 flex h-5.25 items-center">
              <Skeleton className="h-3 w-40 max-w-full" />
            </span>
          </span>
          <span className="flex h-5 items-center max-sm:hidden">
            <Skeleton className="h-3.5 w-28" />
          </span>
          <span className="flex h-5 items-center max-sm:hidden">
            <Skeleton className="h-3.5 w-16" />
          </span>
          <span className="flex h-5.25 items-center max-sm:mt-2">
            <Skeleton className="h-3 w-28" />
          </span>
          <Skeleton className={cn("rounded-tanaw-md h-10.5 w-28 max-sm:hidden", index % 2 === 1 && "invisible")} />
        </div>
      ))}
    </div>
  );
}

/** One text line of the detail pane: the bar sits in the line's own height. */
function DetailLine({ box, bar }: { box: string; bar: string }) {
  return (
    <span className={cn("flex items-center", box)}>
      <Skeleton className={bar} />
    </span>
  );
}

/**
 * The request screen's shape while the requests load: status, title and status note, actions, what
 * happened, the six details, and the start of the conversation.
 */
function DetailSkeleton() {
  return (
    <div aria-hidden="true" className="py-1.5">
      <DetailLine box="h-5.25" bar="h-3 w-36" />
      <DetailLine box="mt-2 h-7.5" bar="h-6 w-3/5" />
      <DetailLine box="mt-2.5 h-5.5" bar="h-3.5 w-2/5" />
      <div className="mt-4.5 flex gap-2.5">
        <Skeleton className="rounded-tanaw-md h-11 w-32" />
        <Skeleton className="rounded-tanaw-md h-11 w-36" />
      </div>
      <DetailLine box="mt-7 h-6.5" bar="h-4 w-32" />
      <div className="mt-1.5">
        <DetailLine box="h-6.5" bar="h-3.5 w-full max-w-136" />
        <DetailLine box="h-6.5" bar="h-3.5 w-4/5 max-w-md" />
      </div>
      <DetailLine box="mt-6 h-6.5" bar="h-4 w-20" />
      <div className="mt-2 grid grid-cols-2 border-t border-(--tanaw-border-soft) max-sm:grid-cols-1">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div key={index} className="border-b border-(--tanaw-border-soft) py-3 pr-4 even:pr-0 max-sm:pr-0">
            <DetailLine box="h-5.25" bar="h-3 w-20" />
            <DetailLine box="mt-0.75 h-6" bar="h-4 w-2/3" />
          </div>
        ))}
      </div>
      <DetailLine box="mt-6 h-6.5" bar="h-4 w-48" />
      <div className="mt-2.5 pl-7.5">
        <DetailLine box="h-6" bar="h-4 w-48" />
        <DetailLine box="mt-0.75 h-5.5" bar="h-3 w-3/4 max-w-120" />
      </div>
    </div>
  );
}

function TableEmptyState({ filtered, hasRequests, onReset, onShowAll }: { filtered: boolean; hasRequests: boolean; onReset: () => void; onShowAll: () => void }) {
  // With the default view (open requests) empty but older requests on record, offer them.
  const nothingOpen = !filtered && hasRequests;
  return (
    <div className="px-3 py-6 max-sm:px-0">
      <p className="font-semibold">{filtered ? "No requests match these filters." : nothingOpen ? "No open requests." : "No requests yet."}</p>
      <p className="mt-1 text-sm text-(--tanaw-text-secondary)">
        {filtered ? "Try another type or status, or clear the search." : nothingOpen ? "Every request is resolved or approved." : "Requests from enterprises and from the sign-in page appear here."}
      </p>
      {(filtered || nothingOpen) && (
        <Button variant="link" size="sm" className="mt-1.5 text-sm font-semibold" onClick={filtered ? onReset : onShowAll}>
          {filtered ? "Clear filters" : "Show every request"}
        </Button>
      )}
    </div>
  );
}

/** The element that scrolls the page: the portal content area, or the document. */
function scrollerOf(element: HTMLElement | null): Element {
  for (let node = element?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement ?? document.documentElement;
}

/** Whether a media query matches, kept current as the window changes. */
function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * The value, or for `ms` after it turns null, the last value it had, so a closing pane can finish
 * sliding out with its content still drawn.
 */
function useLingering<T>(value: T | null, ms: number): T | null {
  const [previous, setPrevious] = useState(value);
  const [kept, setKept] = useState<T | null>(null);
  if (value !== previous) {
    setPrevious(value);
    setKept(value === null && ms > 0 ? previous : null);
  }
  useEffect(() => {
    if (kept === null) return;
    const timer = window.setTimeout(() => setKept(null), ms);
    return () => window.clearTimeout(timer);
  }, [kept, ms]);
  return value ?? kept;
}

/** The current time, refreshed every minute so "Today" and "Just now" stay right. */
function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
