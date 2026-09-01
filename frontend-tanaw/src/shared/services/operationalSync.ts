import { apiClient } from "../lib/apiClient";
import { apiPaths, type ApiNotification, type ApiSchemas } from "@/contracts/api";
import type { FinalReport, FinalReportStatus, IntakeReport, MapEnterprise, OperationalSummary, ReportStatus, VisitorInsightRange, VisitorInsights } from "../types";

export type BackendNotificationSeverity = ApiNotification["severity"];
export type BackendNotification = ApiNotification;

type MapEnterpriseResponse = Omit<MapEnterprise, "lat" | "lng" | "lastSync" | "gatewayStatus"> & {
  lat: number | null;
  lng: number | null;
  lastSync?: string | null;
  gatewayStatus?: MapEnterprise["gatewayStatus"] | null;
};

export type UpdateReportStatusPayload = Omit<ApiSchemas["ReportStatusUpdate"], "status"> & {
  status: Extract<ReportStatus, ApiSchemas["ReportStatusUpdate"]["status"]>;
  remarks?: string;
};

export type FinalReportCreatePayload = ApiSchemas["FinalReportCreate"];

export type FinalReportStatusPayload = Omit<ApiSchemas["FinalReportStatusUpdate"], "status"> & { status: FinalReportStatus };

export type FinalReportRevisionPayload = ApiSchemas["FinalReportRevisionReturn"];

export async function getOperationalSummary() {
  const response = await apiClient.get<OperationalSummary>(apiPaths.telemetrySummary);
  return response.data;
}

export async function listIntakeReports() {
  const response = await apiClient.get<IntakeReport[]>(apiPaths.intakeReports);
  return response.data;
}

export async function updateIntakeReportStatus(reportId: string, payload: UpdateReportStatusPayload) {
  const response = await apiClient.patch<IntakeReport>(`/operational/reports/intake/${reportId}/status`, payload);
  return response.data;
}

export async function listFinalReports() {
  const response = await apiClient.get<FinalReport[]>(apiPaths.finalReports);
  return response.data;
}

export async function createFinalReport(payload: FinalReportCreatePayload) {
  const response = await apiClient.post<FinalReport>(apiPaths.finalReports, payload);
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

export type VisitorInsightParams = {
  range: VisitorInsightRange;
  enterpriseId?: string;
  barangay?: string;
};

export async function getVisitorInsights(params: VisitorInsightParams) {
  const response = await apiClient.get<VisitorInsights>("/operational/visitor-insights", { params });
  return response.data;
}

export async function listUserNotifications() {
  const response = await apiClient.get<BackendNotification[]>(apiPaths.notifications);
  return response.data;
}

export async function updateUserNotificationRead(notificationId: string, read: boolean) {
  const response = await apiClient.patch<BackendNotification>(`/operational/notifications/${notificationId}`, { read });
  return response.data;
}

function hasCoordinates(enterprise: MapEnterpriseResponse): enterprise is MapEnterpriseResponse & { lat: number; lng: number } {
  return typeof enterprise.lat === "number" && Number.isFinite(enterprise.lat) && typeof enterprise.lng === "number" && Number.isFinite(enterprise.lng);
}
