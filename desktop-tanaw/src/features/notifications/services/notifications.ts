import { staffApi } from "../../../lib/axios";
import { useAuthStore } from "../../login/stores/auth-store";

export type BackendNotificationSeverity = "Info" | "Warning" | "Critical" | "Success";

export type BackendNotification = {
  id: string;
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

export type OperationalNotificationEnvelope =
  | { type: "notification.created"; data: BackendNotification }
  | { type: "notification.updated"; data: BackendNotification };

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
  return url.toString();
}

export function createWebSocketAuthMessage() {
  const token = useAuthStore.getState().token;
  return token ? JSON.stringify({ type: "auth", token }) : null;
}
