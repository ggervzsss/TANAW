import { staffApi } from "../../../lib/axios";
import { appendClientGeneration } from "../../../config/client-generation";
import { useAuthStore } from "../../login/stores/auth-store";

export type BackendNotificationSeverity = "Info" | "Warning" | "Critical" | "Success";

export type BackendNotification = {
  id: string;
  recipientAccountId: string;
  title: string;
  message: string;
  type: string;
  severity: BackendNotificationSeverity;
  sourceType: string | null;
  sourceId: string | null;
  createdBy: string | null;
  recipientRole: string;
  recipientEnterpriseId: string | null;
  createdAt: string;
  readAt: string | null;
};

export type OperationalNotificationEnvelope = {
  type: "resource.invalidated";
  data: {
    contractVersion: 2;
    resource: { type: "user_notification"; id: string; version: number };
    scope: { classification: "official"; recipientAccountId: string | null };
    refetchRequired: true;
  };
};

export function parseOperationalNotificationInvalidation(value: string, recipientAccountId: string | undefined): OperationalNotificationEnvelope | null {
  if (!recipientAccountId) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || parsed.type !== "resource.invalidated" || !isRecord(parsed.data)) return null;

    const { data } = parsed;
    if (!isRecord(data.resource) || !isRecord(data.scope)) return null;
    if (
      data.contractVersion !== 2 ||
      data.resource.type !== "user_notification" ||
      typeof data.resource.id !== "string" ||
      typeof data.resource.version !== "number" ||
      data.scope.classification !== "official" ||
      data.scope.recipientAccountId !== recipientAccountId ||
      data.refetchRequired !== true
    ) {
      return null;
    }

    return parsed as OperationalNotificationEnvelope;
  } catch {
    return null;
  }
}

export async function listNotifications() {
  const response = await staffApi.get<BackendNotification[]>("/operational/notifications");
  return response.data;
}

export async function updateNotificationRead(notificationId: string, read: boolean) {
  const response = await staffApi.patch<BackendNotification>(`/operational/notifications/${notificationId}`, { read });
  return response.data;
}

export function getOperationalWebSocketUrl() {
  const baseUrl = staffApi.defaults.baseURL ?? "http://localhost:8000";
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/operational/ws";
  url.search = "";
  url.hash = "";
  return appendClientGeneration(url).toString();
}

export function createWebSocketAuthMessage() {
  const token = useAuthStore.getState().token;
  return token ? JSON.stringify({ type: "auth", token }) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
