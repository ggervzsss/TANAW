import type { ApiSchemas } from "@/contracts/api";
import { listRecentEmailDeliveries } from "@/features/email-deliveries/services/emailDeliveryService";
import { activityLogsQueryKey } from "@/features/system-logs/hooks/useActivityLogs";
import { listActivityLogs } from "@/features/system-logs/services/activityLogService";
import { apiClient } from "@/shared/lib/apiClient";
import { EMAIL_LOG_DAYS, type EmailLogEntry, type SystemActivityLog } from "../model";

export type ActivityCleanupStatus = ApiSchemas["ActivityLogCleanupStatus"];

/** Shares the Admin activity cache, so a purge or refetch updates both. */
export const systemActivityQueryKey = activityLogsQueryKey;
/** Under the activity key, so refreshing activity also refreshes the cleanup status. */
export const activityCleanupQueryKey = [...activityLogsQueryKey, "cleanup"] as const;
/** Under the email-deliveries key, so a retry anywhere refreshes the log. */
export const emailLogQueryKey = ["email-deliveries", "recent", EMAIL_LOG_DAYS] as const;

/** Every activity record IT can read, with the technical detail sent only to IT. */
export async function listSystemActivity(): Promise<SystemActivityLog[]> {
  return listActivityLogs();
}

/** When old activity was last removed, by IT or by the scheduled cleanup. */
export async function getActivityCleanup() {
  const response = await apiClient.get<ActivityCleanupStatus>("/activity-logs/cleanup");
  return response.data;
}

/** Removes activity older than the saved retention period now. */
export async function removeExpiredActivity() {
  const response = await apiClient.post<ApiSchemas["ActivityLogPurgeResponse"]>("/activity-logs/purge-expired");
  return response.data;
}

/** Every email TANAW sent in the last seven days. */
export async function listEmailLog(): Promise<EmailLogEntry[]> {
  return listRecentEmailDeliveries(EMAIL_LOG_DAYS);
}
