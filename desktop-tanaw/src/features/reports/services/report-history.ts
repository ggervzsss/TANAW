import { isAxiosError } from "axios";
import { apiPaths, type ApiSchemas } from "../../../contracts/api";
import { staffApi } from "../../../lib/axios";
import type { ReportReviewStatus } from "../../../types/enterprise";

type ApiIntakeReport = ApiSchemas["IntakeReportSummary"];

/**
 * A report this establishment sent, as TANAW holds it (`IntakeReportSummary`). Each correction
 * Staff ask for is a new version of the month's report, linked to the one before it. The figures
 * this app reads are typed; `version` stays optional because an older TANAW server sends none.
 */
export type EnterpriseIntakeReport = Omit<ApiIntakeReport, "attraction" | "metrics" | "version" | "status" | "remarks" | "notes"> & {
  attraction?: ApiIntakeReport["attraction"];
  status: ReportReviewStatus;
  remarks: string | null;
  notes: string | null;
  metrics: {
    entry: number | null;
    exit: number | null;
    unique: number;
    peak: string | number | null;
  };
  version?: ApiIntakeReport["version"];
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

/**
 * This establishment's own reports in TANAW, newest first, with each version and its review
 * state; `period` narrows it to one month. Until a TANAW server offers this list, the older
 * report list stands in, without versions.
 */
export async function listEnterpriseReportSubmissions(period?: string) {
  try {
    const response = await staffApi.get<EnterpriseIntakeReport[]>(apiPaths.desktopReportSubmissions, period ? { params: { period } } : undefined);
    return response.data;
  } catch (error) {
    const status = isAxiosError(error) ? error.response?.status : undefined;
    if (status !== 404 && status !== 405) throw error;
    const reports = await listEnterpriseReportHistory();
    return period ? reports.filter((report) => report.period === period) : reports;
  }
}

export async function listEnterpriseFinalReports() {
  const response = await staffApi.get<EnterpriseFinalReport[]>("/operational/reports/final");
  return response.data;
}
