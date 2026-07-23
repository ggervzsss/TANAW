import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/app/store/authStore";
import { listActivityLogs } from "../services/activityLogs";

export const activityLogsQueryKey = ["activity-logs"];

export function useActivityLogs(enabled = true) {
  const token = useAuthStore((state) => state.token);
  const role = useAuthStore((state) => state.user?.role);
  const canViewActivityLogs = enabled && (role === "admin" || role === "it");
  const query = useQuery({ queryKey: activityLogsQueryKey, queryFn: listActivityLogs, enabled: Boolean(token) && canViewActivityLogs });

  return {
    ...query,
    logs: query.data ?? [],
  };
}
