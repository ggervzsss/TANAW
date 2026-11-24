import { useQuery } from "@tanstack/react-query";
import { listLiveAlerts, sortLiveAlerts } from "../services/alerts";

export const alertsQueryKey = ["operational-alerts"];

/** The alerts happening now. Refreshed by realtime events, with a slow poll as a fallback. */
export function useAlerts(enabled = true) {
  const query = useQuery({
    queryKey: alertsQueryKey,
    queryFn: listLiveAlerts,
    enabled,
    refetchInterval: 60_000,
    select: sortLiveAlerts,
  });
  return { ...query, alerts: query.data ?? [] };
}
