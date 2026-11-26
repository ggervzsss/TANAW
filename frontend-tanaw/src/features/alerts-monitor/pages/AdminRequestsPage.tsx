import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useScopedPageState } from "@/app/hooks/useScopedPageState";
import { routes } from "@/app/routers/routes";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { Alert, Button, PortalPageHeader, SearchField, Select, Spinner } from "@/shared/ui-kit";
import { RequestDetail, RequestList } from "../components";
import type { Request } from "@/shared/services/requests";
import { useAdminRequests, useRequestDetail, useRequestReadMarks } from "../hooks";
import {
  REQUEST_PARAM,
  countUnread,
  filterRequests,
  findLinkedRequest,
  groupFilterOptions,
  groupRequestsByDay,
  hasActiveFilters,
  initialRequestFilters,
  isRequestFilters,
  statusFilterOptions,
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
    version: 2,
  });

  const visible = useMemo(() => filterRequests(requests, filters), [filters, requests]);
  const groups = useMemo(() => groupRequestsByDay(visible, now), [now, visible]);
  const linked = useMemo(() => findLinkedRequest(requests, searchParams), [requests, searchParams]);
  const linkMissing = searchParams.has(REQUEST_PARAM) && !linked && !isLoading;
  const selected = linked ?? visible[0] ?? null;
  const unread = countUnread(requests);
  const statusOptions = useMemo(() => statusFilterOptions(requests), [requests]);
  const detailQuery = useRequestDetail(selected);
  const { markAllRead } = useRequestReadMarks(selected, !isLoading);

  const select = (request: Request) => {
    const next = new URLSearchParams(searchParams);
    next.set(REQUEST_PARAM, request.id);
    setSearchParams(next, { replace: true });
  };

  const updateFilters = (patch: Partial<RequestFilters>) => setFilters((current) => ({ ...current, ...patch }));
  const clearFilters = () => setFilters(initialRequestFilters);
  const filtered = hasActiveFilters(filters);
  const summary = filtered
    ? `Showing ${visible.length} of ${requests.length} ${requests.length === 1 ? "request" : "requests"}, newest first.`
    : `${requests.length} ${requests.length === 1 ? "request" : "requests"}, newest first.`;

  return (
    <div className="w-full pb-14">
      <PortalPageHeader
        back={{ to: routes.admin.dashboard, label: "Dashboard" }}
        title="Requests"
        description="What people asked IT for: help, and account changes that need IT's approval. IT handles them; you can add a note for IT."
        actions={
          <div className="flex items-center gap-4">
            <p role="status" className="text-sm font-bold text-(--tanaw-text)">
              {isLoading ? "Checking requests" : unreadLabel(unread)}
            </p>
            <Button variant="link" size="sm" className="text-sm font-semibold" disabled={unread === 0} onClick={markAllRead}>
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
          <SearchField id="requests-search" label="Search" value={filters.query} onChange={(query) => updateFilters({ query })} placeholder="Place, request or reference number" />
        </div>
        <div>
          <span aria-hidden="true" className="mb-1.5 block text-xs font-semibold text-(--tanaw-text-secondary)">
            Type
          </span>
          <Select ariaLabel="Type" value={filters.group} options={groupFilterOptions} onChange={(group) => updateFilters({ group: group as RequestFilters["group"] })} />
        </div>
        <div>
          <span aria-hidden="true" className="mb-1.5 block text-xs font-semibold text-(--tanaw-text-secondary)">
            Status
          </span>
          <Select ariaLabel="Status" value={filters.status} options={statusOptions} onChange={(status) => updateFilters({ status: status as RequestFilters["status"] })} />
        </div>
      </div>
      <p className="mt-2.5 text-sm text-(--tanaw-text-secondary)">{isLoading ? "Loading requests." : summary}</p>

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

      <div className="mt-3.5 grid grid-cols-[26rem_minmax(0,1fr)] items-start gap-x-9 gap-y-6 border-t border-(--tanaw-border-soft) pt-3.5 max-[980px]:grid-cols-1">
        <RequestList
          groups={groups}
          selectedId={selected?.id ?? null}
          timeFormat={timeFormat}
          onSelect={select}
          empty={<ListEmptyState isLoading={isLoading} filtered={filtered} onClear={clearFilters} />}
        />
        <div className="sticky top-4 min-w-0 max-[980px]:static">
          {linkMissing && (
            <Alert tone="warning" className="mb-4" title="That request is not in the list. It may have been withdrawn." />
          )}
          {selected ? (
            <RequestDetail request={selected} detail={detailQuery.data ?? null} detailLoading={detailQuery.isLoading} timeFormat={timeFormat} now={now} />
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
        <p className="mt-1 text-sm text-(--tanaw-text-secondary)">Requests from enterprises and from the sign-in page appear here.</p>
      </div>
    );
  }
  return (
    <div className="px-4 py-6">
      <p className="font-bold">No requests match these filters.</p>
      <p className="mt-1 text-sm text-(--tanaw-text-secondary)">Try another group or status, or clear the search.</p>
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
