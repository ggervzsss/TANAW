import { apiClient } from "../lib/apiClient";
import type { SystemLog } from "../types";

export type PurgeExpiredActivityLogsResponse = {
  deletedCount: number;
  retentionDays: number;
};

export async function listActivityLogs() {
  const response = await apiClient.get<SystemLog[]>("/activity-logs");
  return response.data;
}

export async function purgeExpiredActivityLogs() {
  const response = await apiClient.post<PurgeExpiredActivityLogsResponse>("/activity-logs/purge-expired");
  return response.data;
}
