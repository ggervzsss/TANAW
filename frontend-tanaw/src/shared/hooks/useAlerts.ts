import { useQuery } from "@tanstack/react-query";
import { listAlerts } from "../services/alerts";

export const alertsQueryKey = ["operational-alerts"];

export function useAlerts(enabled = true) {
  const query = useQuery({
    queryKey: alertsQueryKey,
    queryFn: listAlerts,
    enabled,
    refetchInterval: 15_000,
  });
  return { ...query, alerts: query.data ?? [] };
}
