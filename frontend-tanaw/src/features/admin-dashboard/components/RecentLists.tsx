import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { routes } from "@/app/routers/routes";
import { useAuthStore } from "@/app/store/authStore";
import { activityLogsQueryKey } from "@/features/system-logs/hooks/useActivityLogs";
import { listActivityLogs } from "@/features/system-logs/services/activityLogService";
import { useSystemDisplayPreferences } from "@/shared/providers/systemDisplayPreferences";
import { listRequests, requestsQueryKey } from "@/shared/services/requests";
import { recordStatusTextClass } from "@/shared/ui-kit";
import { activityTag, latestActivity, latestRequests, requestProgressTone } from "../model/recent";
import { formatDayAndTime, formatRecentTime } from "../model/time";

function RecentSection({ titleId, title, description, link, children }: { titleId: string; title: string; description: string; link: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={titleId} className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={titleId} className="font-display m-0 text-[22px] leading-tight font-bold text-(--tanaw-text)">
          {title}
        </h2>
        {link}
      </div>
      <p className="mt-1 mb-2 text-sm text-(--tanaw-text-secondary)">{description}</p>
      {children}
    </section>
  );
}

function ListMessage({ children }: { children: ReactNode }) {
  return <p className="py-3 text-sm text-(--tanaw-text-secondary)">{children}</p>;
}

export function RecentActivity() {
  const token = useAuthStore((state) => state.token);
  const { timeFormat } = useSystemDisplayPreferences();
  const query = useQuery({ queryKey: activityLogsQueryKey, queryFn: listActivityLogs, enabled: Boolean(token) });
  const logs = latestActivity(query.data ?? []);

  return (
    <RecentSection
      titleId="recent-activity-title"
      title="Recent Activity"
      description="The latest actions and updates across TANAW."
      link={
        <Link to={routes.admin.activity} className="tanaw-dashboard-link">
          View all activity <span aria-hidden="true">›</span>
        </Link>
      }
    >
      {query.isLoading ? (
        <ListMessage>Loading activity…</ListMessage>
      ) : query.isError ? (
        <ListMessage>Activity could not be loaded.</ListMessage>
      ) : logs.length === 0 ? (
        <ListMessage>No activity has been recorded yet.</ListMessage>
      ) : (
        <ul className="m-0 list-none p-0">
          {logs.map((log) => {
            const tag = activityTag(log);
            const content = (
              <>
                <span className="text-sm text-(--tanaw-text-secondary) tabular-nums">{formatDayAndTime(log.timestamp, timeFormat)}</span>
                <span className="truncate text-sm text-(--tanaw-text)" title={log.summary}>
                  {log.summary}
                </span>
                <span className="text-right text-sm font-semibold text-(--tanaw-accent-ink)">{tag}</span>
              </>
            );
            const rowClass = "tanaw-dashboard-row grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-3 px-1 py-3 max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:*:first:col-span-2";
            return (
              <li key={log.id} className="border-t border-(--dash-rule) first:border-t-0">
                {log.group === "Requests" && log.sourceId ? (
                  <Link to={`${routes.admin.requests}?${new URLSearchParams({ request: log.sourceId })}`} className={rowClass}>
                    {content}
                  </Link>
                ) : (
                  <div className={rowClass}>{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </RecentSection>
  );
}

export function RecentRequests() {
  const token = useAuthStore((state) => state.token);
  const { timeFormat } = useSystemDisplayPreferences();
  const requestsQuery = useQuery({ queryKey: requestsQueryKey, queryFn: listRequests, enabled: Boolean(token) });
  const requests = latestRequests(requestsQuery.data ?? []);
  const now = new Date();

  return (
    <RecentSection
      titleId="recent-requests-title"
      title="Recent Requests"
      description="The latest requests people sent to IT."
      link={
        <Link to={routes.admin.requests} className="tanaw-dashboard-link">
          View all requests <span aria-hidden="true">›</span>
        </Link>
      }
    >
      {requestsQuery.isLoading ? (
        <ListMessage>Loading requests…</ListMessage>
      ) : requestsQuery.isError ? (
        <ListMessage>Requests could not be loaded.</ListMessage>
      ) : requests.length === 0 ? (
        <ListMessage>No requests yet.</ListMessage>
      ) : (
        <ul className="m-0 list-none p-0">
          {requests.map((request) => (
            <li key={request.key} className="border-t border-(--dash-rule) first:border-t-0">
              <Link to={`${routes.admin.requests}${request.search}`} className="tanaw-dashboard-row grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 px-1 py-3">
                <span className="truncate text-sm text-(--tanaw-text)">
                  <strong className="font-semibold">{request.title}</strong>
                  {request.place && <span className="text-(--tanaw-text-secondary)">, {request.place}</span>}
                </span>
                <span className="text-sm text-(--tanaw-text-secondary) tabular-nums">{formatRecentTime(request.time, now, timeFormat)}</span>
                <span className={`col-span-2 text-[13px] font-semibold ${recordStatusTextClass[requestProgressTone[request.progress]]}`}>{request.progress}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </RecentSection>
  );
}
