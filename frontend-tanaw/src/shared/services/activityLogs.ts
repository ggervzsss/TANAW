import { apiClient } from "../lib/apiClient";
import type { SystemLog } from "../types";
import { collectCursorPages, type CursorPage } from "./cursorPagination";

export type PurgeExpiredActivityLogsResponse = {
  deletedCount: number;
  retentionDays: number;
};

export const activityLogsQueryKey = ["activity-logs"] as const;

export async function listActivityLogs() {
  return collectCursorPages(async (cursor) => {
    const response = await apiClient.get<CursorPage<SystemLog>>("/activity-logs", {
      params: { limit: 100, ...(cursor ? { cursor } : {}) },
    });
    return response.data;
  }, "activity log");
}

export async function purgeExpiredActivityLogs() {
  const response = await apiClient.post<PurgeExpiredActivityLogsResponse>("/activity-logs/purge-expired");
  return response.data;
}
