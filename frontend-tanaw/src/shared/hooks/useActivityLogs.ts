import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/app/store/authStore";
import { listActivityLogs } from "../services/activityLogs";
import { createOperationalQueryKeys } from "./useOperationalSync";

export { activityLogsQueryKey } from "../services/activityLogs";

export function useActivityLogs() {
  const token = useAuthStore((state) => state.token);
  const user = useAuthStore((state) => state.user);
  const query = useQuery({ queryKey: createOperationalQueryKeys(user).activityLogs, queryFn: listActivityLogs, enabled: Boolean(token && user) });

  return {
    ...query,
    logs: query.data ?? [],
  };
}
