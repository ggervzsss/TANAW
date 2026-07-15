import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/app/store/authStore";
import { listAlerts } from "../services/alerts";
import { createOperationalQueryKeys, operationalAlertsQueryKey } from "./useOperationalSync";

export const alertsQueryKey = operationalAlertsQueryKey;

export function useAlerts(enabled = true) {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const query = useQuery({
    queryKey: createOperationalQueryKeys(user).alerts,
    queryFn: listAlerts,
    enabled: enabled && Boolean(token && user),
    refetchInterval: 15_000,
  });
  return { ...query, alerts: query.data ?? [] };
}
