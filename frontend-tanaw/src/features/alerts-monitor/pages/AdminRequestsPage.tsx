import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useScopedPageState } from "@/app/hooks/useScopedPageState";
import { routes } from "@/app/routers/routes";
import { useAuthStore } from "@/app/store/authStore";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { Alert, Button, PortalPageHeader, SearchField, Select, Spinner } from "@/shared/ui-kit";
import { RequestDetail, RequestList } from "../components";
import { useAdminRequests, useRequestReadState, useRequestTicketDetail } from "../hooks";
import {
  REQUEST_LINK_PARAMS,
  REQUEST_TYPES,
  countUnread,
  filterRequests,
  findLinkedRequest,
  groupRequestsByDay,
  hasActiveFilters,
  hasRequestLink,
  initialRequestFilters,
  isRequestFilters,
  progressFilterOptions,
  requestSearchParams,
  unreadLabel,
  type AdminRequest,
  type RequestFilters,
} from "../model";

const typeOptions = [["all", "All types"] as const, ...REQUEST_TYPES.map((type) => [type, type] as const)];

/**
 * Admin Requests (`/admin/requests`): alerts, High and Urgent support tickets and enterprise profile
 * changes in one list, with the selected request's details and a Message IT composer beside it.
 * The selected request lives in the address: `?alert=<code>`, `?ticket=<id>` or
 * `?account=<accountId>[&change=businessEmail|contactNumber]`, which notifications also use.
 * Read and unread are remembered per Admin in this browser, since the API has no read flag for them.
 */
export function AdminRequestsPage() {
  const { timeFormat } = useSystemDisplayPreferences();
  const userId = useAuthStore((state) => state.user?.id ?? "anonymous");
  const [searchParams, setSearchParams] = useSearchParams();
  const now = useMinuteClock();
  const { requests, logs, isLoading, failedSources, retry } = useAdminRequests();
  const { readState, markRead, markAllRead } = useRequestReadState(userId);
  const [filters, setFilters] = useScopedPageState<RequestFilters>({
    initialValue: initialRequestFilters,
    isValid: isRequestFilters,
    namespace: "admin-requests-filters",
    version: 1,
  });

  const visible = useMemo(() => filterRequests(requests, filters), [filters, requests]);
  const groups = useMemo(() => groupRequestsByDay(visible, now), [now, visible]);
  const linked = useMemo(() => findLinkedRequest(requests, searchParams), [requests, searchParams]);
  const linkMissing = hasRequestLink(searchParams) && !linked && !isLoading;
  const selected = linked ?? visible[0] ?? null;
  const unread = countUnread(requests, readState);
  const progressOptions = useMemo(() => progressFilterOptions(requests), [requests]);
  const ticketQuery = useRequestTicketDetail(selected);

  // Wait for every source: while alerts are in and tickets are not, the "newest" request is a
  // different one, and opening it by default would mark something read the Admin never saw.
  useEffect(() => {
    if (selected && !isLoading) markRead(selected);
  }, [isLoading, markRead, selected]);

  const select = (request: AdminRequest) => {
    const next = new URLSearchParams(searchParams);
    for (const name of REQUEST_LINK_PARAMS) next.delete(name);
    for (const [name, value] of Object.entries(requestSearchParams(request))) next.set(name, value);
    setSearchParams(next, { replace: true });
  };

  const updateFilters = (patch: Partial<RequestFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const clearFilters = () => setFilters(initialRequestFilters);
  const filtered = hasActiveFilters(filters);
  const summary = filtered
    ? `Showing ${visible.length} of ${requests.length} ${requests.length === 1 ? "request" : "requests"}, newest first.`
    : `${requests.length} ${requests.length === 1 ? "request" : "requests"}, newest first.`;

  return (
    <div className="mx-auto w-full max-w-360 pb-14">
      <PortalPageHeader
        back={{ to: routes.admin.dashboard, label: "Dashboard" }}
        title="Requests"
        description="Help requests from enterprises and staff."
        actions={
          <div className="flex items-center gap-4">
            <p role="status" className="text-sm font-bold text-(--tanaw-text)">
              {isLoading ? "Checking requests" : unreadLabel(unread)}
            </p>
            <Button variant="link" size="sm" className="text-sm font-semibold" disabled={unread === 0} onClick={() => markAllRead(requests)}>
              Mark all as read
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-[minmax(0,1fr)_15rem_13rem] items-end gap-3 max-[980px]:grid-cols-1">
        <div>
          <label htmlFor="requests-search" className="mb-1.5 block text-xs font-semibold text-(--tanaw-text-secondary)">
            Search
          </label>
          <SearchField id="requests-search" label="Search" value={filters.query} onChange={(query) => updateFilters({ query })} placeholder="Location, request or reference number" />
        </div>
        <div>
          <span aria-hidden="true" className="mb-1.5 block text-xs font-semibold text-(--tanaw-text-secondary)">
            Type
          </span>
          <Select ariaLabel="Type" value={filters.type} options={typeOptions} onChange={(type) => updateFilters({ type: type as RequestFilters["type"] })} />
        </div>
        <div>
          <span aria-hidden="true" className="mb-1.5 block text-xs font-semibold text-(--tanaw-text-secondary)">
            Progress
          </span>
          <Select ariaLabel="Progress" value={filters.progress} options={progressOptions} onChange={(progress) => updateFilters({ progress: progress as RequestFilters["progress"] })} />
        </div>
      </div>
      <p className="mt-2.5 text-sm text-(--tanaw-text-secondary)">{isLoading ? "Loading requests." : summary}</p>

      {failedSources.length > 0 && (
        <Alert
          tone="danger"
          className="mt-3"
          title={`Some requests could not be loaded: ${failedSources.join(", ")}.`}
          action={
            <Button variant="secondary" size="sm" onClick={retry}>
              Try again
            </Button>
          }
        />
      )}

      <div className="mt-3.5 grid grid-cols-[26rem_minmax(0,1fr)] items-start gap-x-9 gap-y-6 border-t border-(--tanaw-border-soft) pt-3.5 max-[980px]:grid-cols-1">
        <RequestList
          groups={groups}
          selectedKey={selected?.key ?? null}
          readState={readState}
          timeFormat={timeFormat}
          onSelect={select}
          empty={<ListEmptyState isLoading={isLoading} filtered={filtered} onClear={clearFilters} />}
        />
        <div className="sticky top-4 min-w-0 max-[980px]:static">
          {linkMissing && (
            <Alert tone="warning" className="mb-4" title="That request is not in the list. It may have been closed, or it is not shared with Admins." />
          )}
          {selected ? (
            <RequestDetail request={selected} logs={logs} ticket={ticketQuery.data ?? null} ticketLoading={ticketQuery.isLoading} timeFormat={timeFormat} now={now} />
          ) : (
            !isLoading && <p className="py-1.5 text-sm text-(--tanaw-text-secondary)">Select a request to see its details.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ListEmptyState({ isLoading, filtered, onClear }: { isLoading: boolean; filtered: boolean; onClear: () => void }) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 text-sm text-(--tanaw-text-secondary)">
        <Spinner size={16} label="" />
        Loading requests
      </div>
    );
  }
  if (!filtered) {
    return (
      <div className="px-4 py-6">
        <p className="font-bold">No requests yet.</p>
        <p className="mt-1 text-sm text-(--tanaw-text-secondary)">Help requests from enterprises and staff appear here.</p>
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
