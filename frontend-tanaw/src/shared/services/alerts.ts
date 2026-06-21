import { apiClient } from "../lib/apiClient";
import type { PriorityAlert, PriorityAlertStatus } from "../types";

export async function listAlerts() {
  const response = await apiClient.get<PriorityAlert[]>("/operational/alerts");
  return response.data;
}

export async function updateAlertStatus(alertId: string, status: PriorityAlertStatus) {
  const response = await apiClient.patch<PriorityAlert>(`/operational/alerts/${alertId}/status`, { status });
  return response.data;
}
