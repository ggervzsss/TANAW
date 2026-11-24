import { apiPaths } from "@/contracts/api";
import { apiClient } from "../lib/apiClient";
import type { LiveAlert } from "../types";

/** Every alert happening now. Alerts end by themselves, so there is nothing to update. */
export async function listLiveAlerts() {
  const response = await apiClient.get<LiveAlert[]>(apiPaths.alerts);
  return response.data;
}

/** Cameras first (they make the counts incomplete), then newest first. */
export function sortLiveAlerts(alerts: readonly LiveAlert[]) {
  return [...alerts].sort(
    (left, right) =>
      Number(right.type === "Camera Not Counting") - Number(left.type === "Camera Not Counting") ||
      Date.parse(right.startedAt) - Date.parse(left.startedAt) ||
      left.id.localeCompare(right.id),
  );
}
