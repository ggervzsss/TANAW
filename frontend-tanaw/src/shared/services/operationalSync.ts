import { apiClient } from "../lib/apiClient";
import { getWebSocketUrl } from "../config/api.config";
import type { FinalReport, FinalReportStatus, IntakeReport, MapEnterprise, OperationalSummary, PriorityAlert, ReportStatus, TelemetrySnapshot } from "../types";

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

export type OperationalWebSocketEnvelope =
  | { type: "telemetry.snapshot"; data: TelemetrySnapshot }
  | { type: "report.submitted"; data: IntakeReport }
  | { type: "report.updated"; data: IntakeReport }
  | { type: "final_report.generated"; data: FinalReport }
  | { type: "final_report.updated"; data: FinalReport }
  | { type: "summary.updated"; data: OperationalSummary }
  | { type: "alert.created"; data: PriorityAlert }
  | { type: "alert.updated"; data: PriorityAlert }
  | { type: "alert.resolved"; data: PriorityAlert }
  | { type: "notification.created"; data: BackendNotification }
  | { type: "notification.updated"; data: BackendNotification };

type MapEnterpriseResponse = Omit<MapEnterprise, "lat" | "lng" | "lastSync" | "gatewayStatus"> & {
  lat: number | null;
  lng: number | null;
  lastSync?: string | null;
  gatewayStatus?: MapEnterprise["gatewayStatus"] | null;
};

export type UpdateReportStatusPayload = {
  status: Extract<ReportStatus, "Pending Review" | "Ready to Consolidate" | "Returned" | "Consolidated">;
  remarks?: string;
};

export type FinalReportCreatePayload = {
  reportIds: string[];
  preparedBy: string;
};

export type FinalReportStatusPayload = {
  status: FinalReportStatus;
};

export type FinalReportRevisionPayload = {
  sourceReportIds: string[];
  remarks: string;
};

export async function listLatestTelemetry() {
  const response = await apiClient.get<TelemetrySnapshot[]>("/operational/telemetry/latest");
  return response.data;
}

export async function getOperationalSummary() {
  const response = await apiClient.get<OperationalSummary>("/operational/telemetry/summary");
  return response.data;
}

export async function listIntakeReports() {
  const response = await apiClient.get<IntakeReport[]>("/operational/reports/intake");
  return response.data;
}

export async function updateIntakeReportStatus(reportId: string, payload: UpdateReportStatusPayload) {
  const response = await apiClient.patch<IntakeReport>(`/operational/reports/intake/${reportId}/status`, payload);
  return response.data;
}

export async function listFinalReports() {
  const response = await apiClient.get<FinalReport[]>("/operational/reports/final");
  return response.data;
}

export async function createFinalReport(payload: FinalReportCreatePayload) {
  const response = await apiClient.post<FinalReport>("/operational/reports/final", payload);
  return response.data;
}

export async function updateFinalReportStatus(reportId: string, payload: FinalReportStatusPayload) {
  const response = await apiClient.patch<FinalReport>(`/operational/reports/final/${reportId}/status`, payload);
  return response.data;
}

export async function returnFinalReportForRevision(reportId: string, payload: FinalReportRevisionPayload) {
  const response = await apiClient.post<FinalReport>(`/operational/reports/final/${reportId}/return-revision`, payload);
  return response.data;
}

export async function listOperationalMapEnterprises() {
  const response = await apiClient.get<MapEnterpriseResponse[]>("/operational/map-enterprises");
  return response.data.filter(hasCoordinates).map((enterprise) => ({
    ...enterprise,
    lat: enterprise.lat,
    lng: enterprise.lng,
    lastSync: enterprise.lastSync ?? undefined,
    gatewayStatus: enterprise.gatewayStatus ?? "Not Linked",
  }));
}

export async function listUserNotifications() {
  const response = await apiClient.get<BackendNotification[]>("/operational/notifications");
  return response.data;
}

export async function updateUserNotificationRead(notificationId: string, read: boolean) {
  const response = await apiClient.patch<BackendNotification>(`/operational/notifications/${notificationId}`, { read });
  return response.data;
}

export function getOperationalWebSocketUrl() {
  return getWebSocketUrl("/operational/ws");
}

export function createWebSocketAuthMessage(token: string) {
  return JSON.stringify({ type: "auth", token });
}

function hasCoordinates(enterprise: MapEnterpriseResponse): enterprise is MapEnterpriseResponse & { lat: number; lng: number } {
  return typeof enterprise.lat === "number" && Number.isFinite(enterprise.lat) && typeof enterprise.lng === "number" && Number.isFinite(enterprise.lng);
}
