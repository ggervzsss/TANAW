import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { PhoneFilterSheet } from "@/features/admin-enterprises/components/PhoneFilterSheet";
import { usePhoneWidth } from "@/features/admin-enterprises/hooks/useMediaQuery";
import { useScopedPageState } from "@/app/hooks/useScopedPageState";
import { routes } from "@/app/routers/routes";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { Alert, Button, PortalPageHeader, SearchField, Select, Skeleton } from "@/shared/ui-kit";
import { RequestDetail, RequestList } from "../components";
import type { Request } from "@/shared/services/requests";
import { useAdminRequests, useRequestDetail, useRequestReadMarks } from "../hooks";
import {
  REQUEST_PARAM,
  categoryFilterOptions,
  countUnread,
  filterRequests,
  findLinkedRequest,
  groupRequestsByDay,
  hasActiveFilters,
  initialRequestFilters,
  isRequestFilters,
  progressFilterOptions,
  unreadLabel,
  type RequestFilters,
} from "../model";

/**
 * Admin Requests (`/admin/requests`): every request people sent to IT, with the selected request's
 * details and a note-for-IT box beside it. The selected request lives in the address as
 * `?request=<id>`. New and Updated marks come from the server, so they follow the account.
 */
export function AdminRequestsPage() {
  const { timeFormat } = useSystemDisplayPreferences();
  const [searchParams, setSearchParams] = useSearchParams();
  const now = useMinuteClock();
  const { requests, isLoading, isError, retry } = useAdminRequests();
  const [filters, setFilters] = useScopedPageState<RequestFilters>({
    initialValue: initialRequestFilters,
    isValid: isRequestFilters,
    namespace: "admin-requests-filters",
    version: 3,
  });

  const visible = useMemo(() => filterRequests(requests, filters), [filters, requests]);
  const groups = useMemo(() => groupRequestsByDay(visible, now), [now, visible]);
  const linked = useMemo(() => findLinkedRequest(requests, searchParams), [requests, searchParams]);
  const linkMissing = searchParams.has(REQUEST_PARAM) && !linked && !isLoading;
  const selected = linked ?? visible[0] ?? null;
  const unread = countUnread(requests);
  const detailQuery = useRequestDetail(selected);
  // Only a request the Admin picked (a click or a link) is marked read, so its New mark is never
  // cleared unseen when the page opens on it by default.
  const { markAllRead } = useRequestReadMarks(linked ?? null, !isLoading);

  // Phones show the list, and a chosen request as its own screen with a Back button. A tap there is a
  // step in history, so the phone's own back gesture returns to the list too.
  const phone = usePhoneWidth();
  const location = useLocation();
  const navigate = useNavigate();
  const phoneView = searchParams.has(REQUEST_PARAM) ? "detail" : "list";
  const lastOpened = useRef<string | null>(null);

  const select = (request: Request) => {
    const next = new URLSearchParams(searchParams);
    next.set(REQUEST_PARAM, request.id);
    lastOpened.current = request.id;
    if (phone) {
      setSearchParams(next, { state: { fromRequestList: true } });
      scrollPageToTop();
    } else setSearchParams(next, { replace: true });
  };

  const backToList = () => {
    if ((location.state as { fromRequestList?: boolean } | null)?.fromRequestList) {
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    lastOpened.current = next.get(REQUEST_PARAM);
    next.delete(REQUEST_PARAM);
    setSearchParams(next, { replace: true });
  };

  // Back on a phone: return to the request just read, in the list.
  useEffect(() => {
    if (!phone || phoneView !== "list" || !lastOpened.current) return;
    const id = lastOpened.current;
    lastOpened.current = null;
    requestAnimationFrame(() => {
      const row = Array.from(document.querySelectorAll<HTMLElement>("[data-request-id]")).find((element) => element.dataset.requestId === id);
      row?.scrollIntoView({ block: "center" });
      row?.focus({ preventScroll: true });
    });
  }, [phone, phoneView]);

  const updateFilters = (patch: Partial<RequestFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const clearFilters = () => setFilters(initialRequestFilters);
  const filtered = hasActiveFilters(filters);
  const summary = filtered
    ? `Showing ${visible.length} of ${requests.length} ${requests.length === 1 ? "request" : "requests"}, newest first.`
    : `${requests.length} ${requests.length === 1 ? "request" : "requests"}, newest first.`;

  return (
    <div className="tanaw-requests-page w-full pb-14" data-phone-view={phoneView}>
      <div className="tanaw-requests-page__list-only">
        <PortalPageHeader
          back={{ to: routes.admin.dashboard, label: "Dashboard" }}
          title="Requests"
          description="What people asked IT for: help, and account changes that need IT's approval. IT handles them; you can add a note for IT."
          actions={
            <div className="flex items-center gap-4">
              <p role="status" className="text-sm font-semibold text-(--tanaw-text)">
                {isLoading ? "Checking requests" : unreadLabel(unread)}
              </p>
              <Button variant="link" size="sm" className="text-sm font-semibold" disabled={unread === 0} onClick={markAllRead}>
                Mark all as read
              </Button>
            </div>
          }
        />

        <div className="grid grid-cols-[minmax(0,1fr)_15rem_13rem] items-center gap-3 max-[980px]:grid-cols-1 max-md:grid-cols-[minmax(0,1fr)_auto]">
          <SearchField id="requests-search" label="Search" value={filters.query} onChange={(query) => updateFilters({ query })} placeholder="Place, request or reference number" />
          <PhoneFilterSheet
            noun="requests"
            activeCount={(filters.category !== initialRequestFilters.category ? 1 : 0) + (filters.progress !== initialRequestFilters.progress ? 1 : 0)}
            onClear={() => updateFilters({ category: initialRequestFilters.category, progress: initialRequestFilters.progress })}
            resultLabel={isLoading ? undefined : summary}
          >
            {/* In the phone sheet the dropdowns carry visible labels; beside the search they need none. */}
            <Select label={phone ? "Type" : undefined} ariaLabel="Type" value={filters.category} options={categoryFilterOptions} onChange={(category) => updateFilters({ category: category as RequestFilters["category"] })} />
            <Select label={phone ? "Progress" : undefined} ariaLabel="Progress" value={filters.progress} options={progressFilterOptions} onChange={(progress) => updateFilters({ progress: progress as RequestFilters["progress"] })} />
          </PhoneFilterSheet>
        </div>
        <p className="mt-3 text-[13px] text-(--tanaw-text-secondary)">{isLoading ? "Loading requests." : summary}</p>
      </div>

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

      <div className="tanaw-requests-page__panes mt-4 grid grid-cols-[26rem_minmax(0,1fr)] items-start gap-x-10 gap-y-6 border-t border-(--tanaw-border-soft) pt-4 max-[980px]:grid-cols-1">
        <RequestList
          groups={groups}
          // On a phone's list screen no request is open, so none is marked as chosen.
          selectedId={phone && phoneView === "list" ? null : (selected?.id ?? null)}
          timeFormat={timeFormat}
          onSelect={select}
          empty={<ListEmptyState isLoading={isLoading} filtered={filtered} onClear={clearFilters} />}
        />
        <div className="tanaw-requests-page__detail sticky top-4 min-w-0 max-[980px]:static">
          <button type="button" onClick={backToList} className="tanaw-requests-back">
            <ArrowLeft size={18} aria-hidden="true" />
            All requests
          </button>
          {linkMissing && (
            <Alert tone="warning" className="mb-4" title="That request is not in the list. It may have been withdrawn." />
          )}
          {selected ? (
            <RequestDetail key={selected.id} request={selected} detail={detailQuery.data ?? null} detailLoading={detailQuery.isLoading} timeFormat={timeFormat} now={now} />
          ) : (
            isLoading ? <DetailSkeleton /> : <p className="py-1.5 text-sm text-(--tanaw-text-secondary)">Select a request to see its details.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ListEmptyState({ isLoading, filtered, onClear }: { isLoading: boolean; filtered: boolean; onClear: () => void }) {
  if (isLoading) {
    return (
      <div role="status" aria-label="Loading requests">
        <div aria-hidden="true">
          {/* The day heading and request rows at their real line heights (see RequestList and requests.css). */}
          <span className="flex h-[calc(19.5px+1.25rem)] items-center border-b border-(--tanaw-border-soft) px-4 pt-3 pb-2">
            <Skeleton className="h-3.5 w-16" />
          </span>
          {[0, 1, 2, 3].map((index) => (
            <span key={index} className="block border-b border-(--tanaw-border-soft) py-0.5">
              <span className="block px-4 py-3.5">
                <span className="flex h-[19.5px] items-center justify-between gap-3">
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-12" />
                </span>
                <span className="mt-1 flex h-[1.33rem] items-center">
                  <Skeleton className="h-4 w-4/5" />
                </span>
                <span className="mt-0.5 flex h-5 items-center">
                  <Skeleton className="h-3.5 w-36" />
                </span>
                <span className="mt-2 flex h-[19.5px] items-center">
                  <Skeleton className="h-3 w-20" />
                </span>
              </span>
            </span>
          ))}
        </div>
        <span className="sr-only">Loading requests</span>
      </div>
    );
  }
  if (!filtered) {
    return (
      <div className="px-4 py-6">
        <p className="font-bold">No requests yet.</p>
        <p className="mt-1 text-sm text-(--tanaw-text-secondary)">Requests from enterprises and from the sign-in page appear here.</p>
      </div>
    );
  }
  return (
    <div className="px-4 py-6">
      <p className="font-bold">No requests match these filters.</p>
      <p className="mt-1 text-sm text-(--tanaw-text-secondary)">Try another type or progress, or clear the search.</p>
      <Button variant="link" size="sm" className="mt-1.5 text-sm font-semibold" onClick={onClear}>
        Clear filters
      </Button>
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

/** The details pane in its own shape while the requests load: status, title, the story and the details grid. */
function DetailSkeleton() {
  return (
    // Each bar sits in a box of its line's height in RequestDetail, so the details arrive without a jump.
    <div aria-hidden="true" className="py-1.5">
      <span className="flex h-[19.5px] items-center">
        <Skeleton className="h-3.5 w-24" />
      </span>
      <span className="mt-2 flex h-[2.15625rem] items-center max-sm:h-[1.725rem]">
        <Skeleton className="h-8 w-3/4 max-sm:h-6" />
      </span>
      <span className="mt-2.5 flex h-[1.36rem] items-center">
        <Skeleton className="h-4 w-64 max-w-full" />
      </span>
      <span className="mt-6 flex h-6 items-center">
        <Skeleton className="h-4 w-32" />
      </span>
      <span className="mt-1.5 flex h-6.5 items-center">
        <Skeleton className="h-3.5 w-full max-w-[68ch]" />
      </span>
      <span className="flex h-6.5 items-center">
        <Skeleton className="h-3.5 w-5/6 max-w-[60ch]" />
      </span>
      <span className="mt-6 flex h-6 items-center">
        <Skeleton className="h-4 w-20" />
      </span>
      <div className="mt-2 grid grid-cols-2 border-t border-(--tanaw-border-soft) max-sm:grid-cols-1">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <span key={index} className="block border-b border-(--tanaw-border-soft) py-3 pr-4">
            <span className="flex h-[19.5px] items-center">
              <Skeleton className="h-3 w-20" />
            </span>
            <span className="mt-1 flex h-6 items-center">
              <Skeleton className="h-4 w-36 max-w-full" />
            </span>
          </span>
        ))}
      </div>
      <span className="mt-6 flex h-6 items-center">
        <Skeleton className="h-4 w-28" />
      </span>
      <span className="mt-2.5 block border-l-2 border-(--tanaw-border-soft) pb-1 pl-5.5 ml-2">
        <span className="flex h-6 items-center">
          <Skeleton className="h-4 w-44" />
        </span>
        <span className="mt-0.5 flex h-5 items-center">
          <Skeleton className="h-3.5 w-64 max-w-full" />
        </span>
      </span>
    </div>
  );
}

/** Brings a phone's request screen into view from the top, wherever the list was scrolled. */
function scrollPageToTop() {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>("[data-page-scroller]")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  });
}
