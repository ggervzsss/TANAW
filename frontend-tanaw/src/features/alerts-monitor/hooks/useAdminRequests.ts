import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { enterpriseAccountsQueryKey, listEnterpriseAccounts } from "@/features/enterprise-accounts";
import { activityLogsQueryKey } from "@/features/system-logs/hooks/useActivityLogs";
import { listActivityLogs } from "@/features/system-logs/services/activityLogService";
import { useAlerts } from "@/shared/hooks/useAlerts";
import { getSupportTicket, listSupportTickets, supportTicketsQueryKey, type SupportTicket } from "@/shared/services/supportTickets";
import type { AccountSummary, SystemLog } from "@/shared/types";
import { buildAdminRequests, loadReadState, markAllRequestsRead, markRequestRead, saveReadState, type AdminRequest, type RequestReadState } from "../model";

const EMPTY_TICKETS: SupportTicket[] = [];
const EMPTY_ACCOUNTS: AccountSummary[] = [];
const EMPTY_LOGS: SystemLog[] = [];

/** Alerts, High and Urgent tickets and pending profile changes, merged into one list. */
export function useAdminRequests() {
  const alertsQuery = useAlerts();
  const ticketsQuery = useQuery({ queryKey: supportTicketsQueryKey, queryFn: listSupportTickets });
  const accountsQuery = useQuery({ queryKey: enterpriseAccountsQueryKey, queryFn: listEnterpriseAccounts });
  const logsQuery = useQuery({ queryKey: activityLogsQueryKey, queryFn: listActivityLogs });

  const tickets = ticketsQuery.data ?? EMPTY_TICKETS;
  const accounts = accountsQuery.data ?? EMPTY_ACCOUNTS;
  const { alerts } = alertsQuery;
  const requests = useMemo(() => buildAdminRequests({ alerts, tickets, accounts }), [accounts, alerts, tickets]);
  const queries = [alertsQuery, ticketsQuery, accountsQuery];

  return {
    requests,
    logs: logsQuery.data ?? EMPTY_LOGS,
    isLoading: queries.some((query) => query.isLoading),
    /** A source failed and nothing could be shown from it. */
    failedSources: [alertsQuery.isError && "alerts", ticketsQuery.isError && "support tickets", accountsQuery.isError && "account requests"].filter((name): name is string => Boolean(name)),
    retry: () => {
      for (const query of queries) if (query.isError) void query.refetch();
    },
  };
}

/** The selected ticket's conversation, for Latest updates and who is handling it. */
export function useRequestTicketDetail(request: AdminRequest | null) {
  const ticketId = request?.kind === "ticket" ? request.sourceId : null;
  return useQuery({
    queryKey: [...supportTicketsQueryKey, ticketId],
    queryFn: () => getSupportTicket(ticketId ?? ""),
    enabled: Boolean(ticketId),
  });
}

function browserStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Read marks for this Admin, kept in this browser only (the API has no per-Admin read flag). */
export function useRequestReadState(userId: string) {
  const [state, setState] = useState<{ userId: string; seen: RequestReadState }>(() => ({ userId, seen: loadReadState(browserStorage(), userId) }));
  const seen = state.userId === userId ? state.seen : loadReadState(browserStorage(), userId);

  useEffect(() => {
    if (state.userId === userId) saveReadState(browserStorage(), userId, state.seen);
  }, [state, userId]);

  const markRead = useCallback(
    (request: AdminRequest) =>
      setState((current) => {
        const base = current.userId === userId ? current.seen : loadReadState(browserStorage(), userId);
        const next = markRequestRead(base, request);
        return next === base && current.userId === userId ? current : { userId, seen: next };
      }),
    [userId],
  );
  const markAllRead = useCallback((requests: readonly AdminRequest[]) => setState({ userId, seen: markAllRequestsRead(requests) }), [userId]);

  return { readState: seen, markRead, markAllRead };
}
