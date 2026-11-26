import { queryOptions, useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/app/store/authStore";
import {
  getVisitorInsights,
  getVisitorRanking,
  listFinalReports,
  listIntakeReports,
  listOperationalMapEnterprises,
  listUserNotifications,
  type VisitorInsightParams,
} from "@/shared/services/operationalSync";

export const operationalReportsQueryKey = ["operational", "reports", "intake"];
export const operationalFinalReportsQueryKey = ["operational", "reports", "final"];
export const operationalMapEnterprisesQueryKey = ["operational", "map-enterprises"];
export const operationalNotificationsQueryKey = ["operational", "notifications"];
export const visitorInsightsQueryKey = ["operational", "visitor-insights"];
export const visitorRankingQueryKey = ["operational", "visitor-ranking"];

export function useOperationalReports() {
  const token = useAuthStore((state) => state.token);
  return useQuery({ queryKey: operationalReportsQueryKey, queryFn: listIntakeReports, enabled: Boolean(token) });
}

export function useOperationalFinalReports() {
  const token = useAuthStore((state) => state.token);
  return useQuery({ queryKey: operationalFinalReportsQueryKey, queryFn: listFinalReports, enabled: Boolean(token) });
}

export const OPERATIONAL_MAP_REFRESH_MS = 30_000;

/**
 * The map refreshes on a 30-second fallback poll while its tab is visible, in
 * case a live update is missed. The poll pauses in a hidden tab, and showing the
 * tab again refetches the map once if its data is older than one interval.
 */
export const operationalMapEnterprisesQueryOptions = queryOptions({
  queryKey: operationalMapEnterprisesQueryKey,
  queryFn: listOperationalMapEnterprises,
  refetchInterval: OPERATIONAL_MAP_REFRESH_MS,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
  staleTime: OPERATIONAL_MAP_REFRESH_MS,
});

export function useOperationalMapEnterprises() {
  const token = useAuthStore((state) => state.token);
  return useQuery({ ...operationalMapEnterprisesQueryOptions, enabled: Boolean(token) });
}

export function useVisitorInsights(params: VisitorInsightParams, enabled = true) {
  const token = useAuthStore((state) => state.token);
  return useQuery({
    queryKey: [...visitorInsightsQueryKey, params],
    queryFn: () => getVisitorInsights(params),
    enabled: Boolean(token) && enabled,
  });
}

const VISITOR_RANKING_STALE_MS = 60_000;

/** One request for Most Visited: visitors per enterprise for the range. */
export function useVisitorRanking(params: { start: string; end: string }, enabled = true) {
  const token = useAuthStore((state) => state.token);
  return useQuery({
    queryKey: [...visitorRankingQueryKey, params],
    queryFn: () => getVisitorRanking(params),
    enabled: Boolean(token) && enabled,
    staleTime: VISITOR_RANKING_STALE_MS,
  });
}

export function useOperationalNotifications() {
  const token = useAuthStore((state) => state.token);
  return useQuery({ queryKey: operationalNotificationsQueryKey, queryFn: listUserNotifications, enabled: Boolean(token) });
}
