import { apiClient } from "../lib/apiClient";
import { getWebSocketUrl } from "../config/api.config";
import type { LogSeverity, SystemLog, SystemLogActorRole, SystemLogCategory } from "../types";

export type CreateActivityLogPayload = {
  category: SystemLogCategory;
  severity?: LogSeverity;
  actor?: string;
  actorRole?: SystemLogActorRole;
  action: string;
  target: string;
  summary: string;
  sourceId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export async function listActivityLogs() {
  const response = await apiClient.get<SystemLog[]>("/activity-logs");
  return response.data;
}

export async function recordActivityLog(payload: CreateActivityLogPayload) {
  const response = await apiClient.post<SystemLog>("/activity-logs", {
    actor: payload.actor ?? "TANAW User",
    actorRole: payload.actorRole ?? "System",
    severity: payload.severity ?? "Info",
    ...payload,
  });
  return response.data;
}

export function getActivityLogsWebSocketUrl() {
  return getWebSocketUrl("/activity-logs/ws");
}

export function createWebSocketAuthMessage(token: string) {
  return JSON.stringify({ type: "auth", token });
}
