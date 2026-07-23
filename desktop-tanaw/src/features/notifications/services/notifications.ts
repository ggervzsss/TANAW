import { staffApi } from "../../../lib/axios";

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

export async function listNotifications() {
  const response = await staffApi.get<BackendNotification[]>("/operational/notifications");
  return response.data;
}

export async function updateNotificationRead(notificationId: string, read: boolean) {
  const response = await staffApi.patch<BackendNotification>(`/operational/notifications/${notificationId}`, { read });
  return response.data;
}
