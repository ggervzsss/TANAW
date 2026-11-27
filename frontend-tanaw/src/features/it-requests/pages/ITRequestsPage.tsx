import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
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

const NARROW_QUERY = "(max-width: 980px)";
const filterLabel = "mb-1.5 block text-[13px] font-medium text-(--tanaw-text-secondary)";

/**
 * IT Requests (`/it/requests`): help and approval requests from enterprises and the sign-in page,
 * grouped by day beside the selected request. Only IT changes a request's status; the Admin can add
 * notes. The filters and the selected request (`?request=<id>`) live in the address.
 */
export function ITRequestsPage() {
  const { dateFormat, timeFormat } = useSystemDisplayPreferences();
  const user = useAuthStore((state) => state.user);
  const viewer: Viewer = useMemo(() => ({ id: user?.id ?? null, name: user?.displayName ?? null }), [user?.displayName, user?.id]);
  const [searchParams, setSearchParams] = useSearchParams();
  const now = useMinuteClock();
  const detailRef = useRef<HTMLDivElement | null>(null);
  const { requests, isLoading, isError, retry } = useAdminRequests();

  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);
  const visible = useMemo(() => filterItRequests(requests, filters, viewer.id), [filters, requests, viewer.id]);
  const groups = useMemo(() => groupByDay(visible, now, dateFormat), [dateFormat, now, visible]);
  const linked = useMemo(() => findSelectedRequest(requests, searchParams), [requests, searchParams]);
  const linkMissing = searchParams.has(REQUEST_PARAM) && !linked && !isLoading && !isError;
  const selected = linked ?? visible[0] ?? null;
  const ownerOptions = useMemo(() => ownerFilterOptions(requests, viewer.id, filters.owner), [filters.owner, requests, viewer.id]);
  const waiting = countNotPickedUp(requests);
  const detailQuery = useRequestDetail(selected);
  useRequestReadMarks(selected, !isLoading);

  const updateFilters = (patch: Partial<ItRequestFilters>) => setSearchParams(filtersToParams({ ...filters, ...patch }, searchParams), { replace: true });
  const clearFilters = () => setSearchParams(filtersToParams(clearedFilters, searchParams), { replace: true });

  const select = (request: Request) => {
    const next = new URLSearchParams(searchParams);
    next.set(REQUEST_PARAM, request.id);
    setSearchParams(next, { replace: true });
    // List and detail stack on narrow screens: bring the request into view.
    if (window.matchMedia(NARROW_QUERY).matches) {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" }));
    }
  };

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

  return (
    <div className="w-full pb-14">
      <PortalPageHeader
        title="Requests"
        description="Help and approval requests from enterprises and the sign-in page. Only IT changes a request's status. Admin can add notes."
        actions={
          <p role="status" className={cn("text-sm font-semibold", waiting === 0 ? "text-(--tanaw-accent-ink)" : "text-(--tanaw-warn-ink)")}>
            {isLoading ? "Checking requests" : notPickedUpLabel(waiting)}
          </p>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)_16rem_13rem_13rem] items-end gap-3 max-[1180px]:grid-cols-3 max-[980px]:grid-cols-1">
        <div className="max-[1180px]:col-span-3 max-[980px]:col-span-1">
          <label htmlFor="it-requests-search" className={filterLabel}>
            Search
          </label>
          <SearchField id="it-requests-search" label="Search" value={filters.query} onChange={(query) => updateFilters({ query })} placeholder="Place, request or reference number" />
        </div>
        <FilterSelect label="Type" value={typeSlug(filters.type)} options={typeFilterOptions} onChange={(value) => updateFilters({ type: typeFromSlug(value) })} />
        <FilterSelect label="Status" value={filters.status} options={statusFilterOptions} onChange={(value) => updateFilters({ status: value as StatusFilter })} />
        <FilterSelect label="Handled by" value={filters.owner} options={ownerOptions} onChange={(owner) => updateFilters({ owner })} />
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
        <div ref={detailRef} className="min-w-0 scroll-mt-4">
          {linkMissing && <Alert tone="warning" className="mb-4" title="That request is not in the list. It may have been withdrawn." />}
          {selected ? (
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
          ) : (
            <p className="py-1.5 text-sm text-(--tanaw-text-secondary)">Select a request to see its details.</p>
          )}
        </div>
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

/** Request rows in the list's shape while the requests load. */
function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading requests" className="px-3 pt-3">
      <Skeleton className="mb-1.5 h-3 w-16" />
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} className="border-b border-(--tanaw-border-soft) py-3.5">
          <span className="flex justify-between gap-3">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-12" />
          </span>
          <Skeleton className="mt-2.5 h-4 w-4/5" />
          <Skeleton className="mt-2 h-3 w-1/2" />
          <Skeleton className="mt-3 h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

/** The detail pane's shape while the requests load: status, title, actions and details. */
function DetailSkeleton() {
  return (
    <div aria-hidden="true" className="py-1.5">
      <Skeleton className="h-3 w-36" />
      <Skeleton className="mt-3 h-7 w-3/5" />
      <Skeleton className="mt-3 h-4 w-2/5" />
      <div className="mt-5 flex gap-2.5">
        <Skeleton className="rounded-tanaw-md h-11 w-32" />
        <Skeleton className="rounded-tanaw-md h-11 w-36" />
      </div>
      <Skeleton className="mt-7 h-4 w-32" />
      <Skeleton className="mt-3 h-3 w-full max-w-136" />
      <Skeleton className="mt-2 h-3 w-4/5 max-w-md" />
      <div className="mt-6 grid grid-cols-2 gap-x-4 border-t border-(--tanaw-border-soft) max-sm:grid-cols-1">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="border-b border-(--tanaw-border-soft) py-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-4 w-2/3" />
          </div>
        ))}
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

/** The current time, refreshed every minute so "Today" and "Just now" stay right. */
function useMinuteClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
