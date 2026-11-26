import { apiClient } from "@/shared/lib/apiClient";
import type { SystemLog } from "@/shared/types";

export async function listActivityLogs() {
  const response = await apiClient.get<SystemLog[]>("/activity-logs");
  return response.data;
}
