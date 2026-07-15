import { apiClient } from "../lib/apiClient";
import type { PriorityAlert, PriorityAlertStatus } from "../types";
import { collectCursorPages, type CursorPage } from "./cursorPagination";

export async function listAlerts() {
  return collectCursorPages(async (cursor) => {
    const response = await apiClient.get<CursorPage<PriorityAlert>>("/operational/alerts", {
      params: { limit: 100, ...(cursor ? { cursor } : {}) },
    });
    return response.data;
  }, "operational alert");
}

export async function updateAlertStatus(alertId: string, status: PriorityAlertStatus) {
  const response = await apiClient.patch<PriorityAlert>(`/operational/alerts/${alertId}/status`, { status });
  return response.data;
}
