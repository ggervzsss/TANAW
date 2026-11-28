import { ArrowLeft, ChevronDown, SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/app/store/authStore";
import { useAdminRequests, useRequestDetail, useRequestReadMarks } from "@/features/alerts-monitor/hooks";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import type { Request } from "@/shared/services/requests";
import { Alert, Button, PortalPageHeader, SearchField, Select, Skeleton, cn } from "@/shared/ui-kit";
import { ITRequestDetail, ITRequestList } from "../components";
import {
  REQUEST_PARAM,
  clearedFilters,
  countNotPickedUp,
  defaultFilters,
  filterItRequests,
  filtersToParams,
  findSelectedRequest,
  formatWhen,
  groupByDay,
  listSummary,
  notPickedUpLabel,
  ownerFilterOptions,
  parseFilters,
  statusFilterOptions,
  typeFilterOptions,
  typeFromSlug,
  typeSlug,
  type ItRequestFilters,
  type StatusFilter,
  type Viewer,
} from "../model";

/** Below this width the list and the request are two screens: the list, then the request with a Back. */
const NARROW_QUERY = "(max-width: 980px)";
const filterLabel = "mb-1.5 block text-[13px] font-medium text-(--tanaw-text-secondary)";

/** Marks a request opened from the list on a narrow screen, so Back returns to the list where it was. */
type ListState = { fromRequestList?: boolean } | null;

/**
 * IT Requests (`/it/requests`): help and approval requests from enterprises and the sign-in page,
 * grouped by day beside the selected request. Only IT changes a request's status; the Admin can add
 * notes. The filters and the selected request (`?request=<id>`) live in the address. On narrow
 * screens the list comes first, and a request opens as its own screen with a Back to the list.
 */
export function ITRequestsPage() {
  const { dateFormat, timeFormat } = useSystemDisplayPreferences();
  const user = useAuthStore((state) => state.user);
  const viewer: Viewer = useMemo(() => ({ id: user?.id ?? null, name: user?.displayName ?? null }), [user?.displayName, user?.id]);
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const narrow = useMediaQuery(NARROW_QUERY);
  const now = useMinuteClock();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listScroll = useRef<number | null>(null);
  const filtersId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { requests, isLoading, isError, retry } = useAdminRequests();

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const visible = useMemo(() => filterItRequests(requests, filters, viewer.id), [filters, requests, viewer.id]);
  const groups = useMemo(() => groupByDay(visible, now, dateFormat), [dateFormat, now, visible]);
  const linked = useMemo(() => findSelectedRequest(requests, searchParams), [requests, searchParams]);
  const linkMissing = searchParams.has(REQUEST_PARAM) && !linked && !isLoading && !isError;
  // Side by side, the newest request shows until another is picked. As two screens, the list
  // shows until a request is opened.
  const selected = linked ?? (narrow ? null : (visible[0] ?? null));
  const requestScreen = narrow && searchParams.has(REQUEST_PARAM);
  const ownerOptions = useMemo(() => ownerFilterOptions(requests, viewer.id, filters.owner), [filters.owner, requests, viewer.id]);
  const waiting = countNotPickedUp(requests);
  const detailQuery = useRequestDetail(selected);
  // Only a request someone picked (a click or a link) counts as read; the one shown by default does
  // not, so it is never marked "Seen by IT" just because the page opened.
  useRequestReadMarks(linked ?? null, !isLoading);

  const updateFilters = (patch: Partial<ItRequestFilters>) => setSearchParams(filtersToParams({ ...filters, ...patch }, searchParams), { replace: true });
  const clearFilters = () => setSearchParams(filtersToParams(clearedFilters, searchParams), { replace: true });

  const select = (request: Request) => {
    const next = new URLSearchParams(searchParams);
    next.set(REQUEST_PARAM, request.id);
    if (!narrow) {
      setSearchParams(next, { replace: true });
      return;
    }
    // The request opens as its own screen: the browser's Back returns to the list, where it was.
    listScroll.current = scrollerOf(rootRef.current).scrollTop;
    setSearchParams(next, { state: { fromRequestList: true } satisfies ListState });
  };

  const backToList = () => {
    if ((location.state as ListState)?.fromRequestList) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete(REQUEST_PARAM);
    setSearchParams(next, { replace: true });
  };

  // Moving between the list and a request screen: a request starts at its top, and the list comes
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

  const activeFilters = [filters.type !== defaultFilters.type, filters.status !== defaultFilters.status, filters.owner !== defaultFilters.owner].filter(Boolean).length;
  const filterSummary = [
    statusFilterOptions.find(([value]) => value === filters.status)?.[1],
    typeFilterOptions.find(([value]) => value === typeSlug(filters.type))?.[1],
    ownerOptions.find(([value]) => value === filters.owner)?.[1],
  ]
    .filter(Boolean)
    .join(" · ");

  // After an action the request may leave the filtered list (resolved under "Open"): keep it selected.
  const keepSelected = (request: Request) =>
    setSearchParams(
      (current) => {
        if (current.get(REQUEST_PARAM)) return current;
        const next = new URLSearchParams(current);
        next.set(REQUEST_PARAM, request.id);
        return next;
      },
      { replace: true },
    );

  const when = (value: string) => formatWhen(value, now, dateFormat, timeFormat);

  const detail = selected ? (
    <ITRequestDetail
      key={selected.id}
      request={selected}
      detail={detailQuery.data ?? null}
      detailLoading={detailQuery.isLoading}
      viewer={viewer}
      now={now}
      formatWhen={when}
      onActed={keepSelected}
    />
  ) : isLoading ? (
    <DetailSkeleton />
  ) : null;

  if (requestScreen) {
    return (
      <div ref={rootRef} className="w-full pb-14">
        <h1 className="sr-only">Requests</h1>
        <button
          type="button"
          onClick={backToList}
          className="group rounded-tanaw-sm -ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm font-semibold text-(--tanaw-text-secondary) transition-colors duration-150 hover:text-(--tanaw-accent-ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
        >
          <ArrowLeft size={16} aria-hidden="true" className="ease-tanaw-out transition-transform duration-150 group-hover:-translate-x-0.5 motion-reduce:transition-none" />
          Requests
        </button>
        <div className="mt-2 min-w-0">
          {linkMissing && <Alert tone="warning" className="mb-4" title="That request is not in the list. It may have been withdrawn." />}
          {detail}
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="w-full pb-14">
      <PortalPageHeader
        title="Requests"
        description="Help and approval requests from enterprises and the sign-in page. Only IT changes a request's status. Admin can add notes."
        actions={
          <p role="status" className={cn("text-sm font-semibold", waiting === 0 ? "text-(--tanaw-accent-ink)" : "text-(--tanaw-warn-ink)")}>
            {isLoading ? "Checking requests" : notPickedUpLabel(waiting)}
          </p>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)_16rem_13rem_13rem] items-end gap-3 max-[1180px]:grid-cols-3 max-sm:grid-cols-1">
        <div className="max-[1180px]:col-span-3 max-sm:col-span-1">
          <label htmlFor="it-requests-search" className={filterLabel}>
            Search
          </label>
          <SearchField id="it-requests-search" label="Search" value={filters.query} onChange={(query) => updateFilters({ query })} placeholder="Place, request or reference number" />
        </div>
        {/* On phones the three filters fold under one row that says what they are set to. */}
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
          <FilterSelect label="Type" value={typeSlug(filters.type)} options={typeFilterOptions} onChange={(value) => updateFilters({ type: typeFromSlug(value) })} />
          <FilterSelect label="Status" value={filters.status} options={statusFilterOptions} onChange={(value) => updateFilters({ status: value as StatusFilter })} />
          <FilterSelect label="Handled by" value={filters.owner} options={ownerOptions} onChange={(owner) => updateFilters({ owner })} />
        </div>
      </div>
      <p className="mt-3 text-[13px] text-(--tanaw-text-secondary)">{isLoading ? "Loading requests." : listSummary(visible.length)}</p>

      {isError && (
        <Alert
          tone="danger"
          className="mt-3"
          title="Requests could not be loaded."
          action={
            <Button variant="secondary" size="sm" onClick={retry}>
              Try again
            </Button>
          }
        />
      )}

      <div className="mt-3 grid grid-cols-[26rem_minmax(0,1fr)] items-start gap-x-8 gap-y-6 border-t border-(--tanaw-border-soft) pt-3 max-[980px]:grid-cols-1">
        <ITRequestList
          groups={groups}
          selectedId={selected?.id ?? null}
          viewer={viewer}
          timeFormat={timeFormat}
          onSelect={select}
          empty={<ListEmptyState isLoading={isLoading} filtered={requests.length > 0} onClear={clearFilters} />}
        />
        {!narrow && (
          <div className="min-w-0">
            {linkMissing && <Alert tone="warning" className="mb-4" title="That request is not in the list. It may have been withdrawn." />}
            {detail ?? <p className="py-1.5 text-sm text-(--tanaw-text-secondary)">Select a request to see its details.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: ReadonlyArray<readonly [string, string]>; onChange: (value: string) => void }) {
  return (
    <div>
      <span aria-hidden="true" className={filterLabel}>
        {label}
      </span>
      <Select ariaLabel={label} value={value} options={options} onChange={onChange} />
    </div>
  );
}

/**
 * Request rows in the list's shape while the requests load: a day heading, then rows with the type
 * and time, title, place, and status line, each bar in its text line's own height.
 */
function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading requests">
      <span className="flex h-5 box-content items-center px-3 pt-3 pb-1.5">
        <Skeleton className="h-3 w-16" />
      </span>
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} className="border-b border-(--tanaw-border-soft) px-3 py-3.5">
          <span className="flex h-5 items-center justify-between gap-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-12" />
          </span>
          <span className="mt-1 flex h-5.5 items-center">
            <Skeleton className="h-4 w-4/5" />
          </span>
          <span className="mt-0.5 flex h-5 items-center">
            <Skeleton className="h-3.5 w-1/2" />
          </span>
          <span className="mt-2 flex h-5 items-center">
            <Skeleton className="h-3 w-28" />
          </span>
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
 * The detail pane's shape while the requests load: status, title and status note, actions, what
 * happened, the six details, and the start of the conversation.
 */
function DetailSkeleton() {
  return (
    <div aria-hidden="true" className="py-1.5">
      <DetailLine box="h-5" bar="h-3 w-36" />
      <DetailLine box="mt-2 h-7" bar="h-5.5 w-3/5" />
      <DetailLine box="mt-2.5 h-5.5" bar="h-3.5 w-2/5" />
      <div className="mt-4.5 flex gap-2.5">
        <Skeleton className="rounded-tanaw-md h-11 w-32" />
        <Skeleton className="rounded-tanaw-md h-11 w-36" />
      </div>
      <DetailLine box="mt-7 h-6" bar="h-4 w-32" />
      <div className="mt-1.5">
        <DetailLine box="h-6.5" bar="h-3.5 w-full max-w-136" />
        <DetailLine box="h-6.5" bar="h-3.5 w-4/5 max-w-md" />
      </div>
      <DetailLine box="mt-6 h-6" bar="h-4 w-20" />
      <div className="mt-2 grid grid-cols-2 border-t border-(--tanaw-border-soft) max-sm:grid-cols-1">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div key={index} className="border-b border-(--tanaw-border-soft) py-3 pr-4 even:pr-0 max-sm:pr-0">
            <DetailLine box="h-5" bar="h-3 w-20" />
            <DetailLine box="mt-0.75 h-6" bar="h-4 w-2/3" />
          </div>
        ))}
      </div>
      <DetailLine box="mt-6 h-6" bar="h-4 w-48" />
      <div className="mt-2.5 pl-7.5">
        <DetailLine box="h-6" bar="h-4 w-48" />
        <DetailLine box="mt-0.75 h-5" bar="h-3 w-3/4 max-w-120" />
      </div>
    </div>
  );
}

function ListEmptyState({ isLoading, filtered, onClear }: { isLoading: boolean; filtered: boolean; onClear: () => void }) {
  if (isLoading) return <ListSkeleton />;
  return (
    <div className="px-3 py-6">
      <p className="font-semibold">{filtered ? "No requests match these filters." : "No requests yet."}</p>
      <p className="mt-1 text-sm text-(--tanaw-text-secondary)">
        {filtered ? "Try another type, status or person, or clear the search." : "Requests from enterprises and from the sign-in page appear here."}
      </p>
      {filtered && (
        <Button variant="link" size="sm" className="mt-1.5 text-sm font-semibold" onClick={onClear}>
          Clear filters
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

/** The current time, refreshed every minute so "Today" and "Just now" stay right. */
function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
