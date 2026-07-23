import { useQuery } from "@tanstack/react-query";
import { listAlerts } from "../services/alerts";

export const alertsQueryKey = ["operational-alerts"];

export function useAlerts(enabled = true) {
  const query = useQuery({
    queryKey: alertsQueryKey,
    queryFn: listAlerts,
    enabled,
  });
  return { ...query, alerts: query.data ?? [] };
}
