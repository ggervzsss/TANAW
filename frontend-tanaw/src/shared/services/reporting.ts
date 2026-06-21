import { apiClient } from "../lib/apiClient";
import type { IntakeReport, ReportEnterprise } from "../types";
import {
  createFinalReport,
  listFinalReports,
  listIntakeReports as listOperationalIntakeReports,
  updateFinalReportStatus,
  updateIntakeReportStatus,
  type FinalReportCreatePayload,
  type FinalReportStatusPayload,
  type UpdateReportStatusPayload,
} from "./operationalSync";

export async function listReportEnterprises() {
  const response = await apiClient.get<ReportEnterprise[]>("/operational/reports/enterprises");
  return response.data;
}

export async function listIntakeReports(): Promise<IntakeReport[]> {
  return listOperationalIntakeReports();
}

export { createFinalReport, listFinalReports, updateFinalReportStatus, updateIntakeReportStatus, type FinalReportCreatePayload, type FinalReportStatusPayload, type UpdateReportStatusPayload };
