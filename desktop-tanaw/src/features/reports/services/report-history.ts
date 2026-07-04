import { staffApi } from "../../../lib/axios";

export type EnterpriseIntakeReport = {
  id: string;
  enterpriseId: string;
  enterprise: string;
  category: string;
  barangay: string;
  month: string;
  period: string;
  submitted: string;
  submittedAt: string;
  status: "Pending Review" | "Ready to Consolidate" | "Returned" | "Consolidated";
  code: string;
  remarks: string | null;
  notes: string | null;
  metrics: {
    entry: number;
    exit: number;
    unique: number;
    peak: string | number;
  };
  payload?: Record<string, unknown> | null;
};

export type EnterpriseFinalReport = {
  id: string;
  period: string;
  status: "Draft" | "Finalized" | "Archived";
  archivedFromStatus?: "Draft" | "Finalized" | null;
  sources: {
    id: string;
    code: string;
    enterprise: string;
  }[];
};

export async function listEnterpriseReportHistory() {
  const response = await staffApi.get<EnterpriseIntakeReport[]>("/operational/reports/intake");
  return response.data;
}

export async function listEnterpriseFinalReports() {
  const response = await staffApi.get<EnterpriseFinalReport[]>("/operational/reports/final");
  return response.data;
}
