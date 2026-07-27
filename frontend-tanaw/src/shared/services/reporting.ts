import { apiClient } from "../lib/apiClient";
import type { ReportEnterprise } from "../types";
import {
  createFinalReport,
  listFinalReports,
  returnFinalReportForRevision,
  updateFinalReportStatus,
  updateIntakeReportStatus,
  type FinalReportRevisionPayload,
  type FinalReportCreatePayload,
  type FinalReportStatusPayload,
  type UpdateReportStatusPayload,
} from "./operationalSync";

export async function listReportEnterprises() {
  const response = await apiClient.get<ReportEnterprise[]>("/operational/reports/enterprises");
  return response.data;
}

export type EnterpriseNotificationPayload = {
  enterpriseId: string;
  title: string;
  message: string;
  type?: string;
  severity?: "Info" | "Warning" | "Critical" | "Success";
  sourceType?: string;
  sourceId?: string;
};

export async function notifyEnterprise(payload: EnterpriseNotificationPayload) {
  const response = await apiClient.post("/operational/notifications/enterprise", payload);
  return response.data;
}

export {
  createFinalReport,
  listFinalReports,
  returnFinalReportForRevision,
  updateFinalReportStatus,
  updateIntakeReportStatus,
  type FinalReportCreatePayload,
  type FinalReportRevisionPayload,
  type FinalReportStatusPayload,
  type UpdateReportStatusPayload,
};
