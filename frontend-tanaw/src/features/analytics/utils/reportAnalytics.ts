import type { IntakeReport, ReportEnterprise } from "@/shared/types";

export const MONTH_ORDER = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const ACCEPTED_REPORT_STATUSES = new Set<IntakeReport["status"]>(["Ready to Consolidate", "Consolidated"]);

export type AnalyticsPeriod = {
  key: string;
  label: string;
  monthIndex: number;
  reports: IntakeReport[];
  year: string;
};

export type EnterpriseReportRow = {
  enterprise: ReportEnterprise;
  reports: IntakeReport[];
  accepted: boolean;
};

export type BarangayCoverageRow = {
  barangay: string;
  accepted: number;
  awaitingAcceptance: number;
  total: number;
};

export function getAnalyticsPeriods(reports: IntakeReport[], currentPeriod: AnalyticsPeriod) {
  const periodMap = new Map<string, AnalyticsPeriod>([[currentPeriod.key, { ...currentPeriod, reports: [] }]]);

  for (const report of reports) {
    const year = getReportYear(report);
    const monthIndex = MONTH_ORDER.indexOf(report.month);
    if (!year || monthIndex === -1) continue;

    const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    const existing = periodMap.get(key);
    periodMap.set(key, {
      key,
      label: existing?.label ?? `${report.month} ${year}`,
      monthIndex,
      reports: [...(existing?.reports ?? []), report],
      year,
    });
  }

  return Array.from(periodMap.values()).sort((left, right) => Number(right.year) - Number(left.year) || right.monthIndex - left.monthIndex);
}

export function getAcceptedReports(reports: IntakeReport[]) {
  const latestByEnterprise = new Map<string, IntakeReport>();
  for (const report of reports) {
    if (!ACCEPTED_REPORT_STATUSES.has(report.status)) continue;
    const existing = latestByEnterprise.get(report.enterpriseId);
    if (!existing || getReportTime(report) >= getReportTime(existing)) {
      latestByEnterprise.set(report.enterpriseId, report);
    }
  }
  return Array.from(latestByEnterprise.values());
}

export function getEnterpriseReportRows(enterprises: ReportEnterprise[], reports: IntakeReport[]): EnterpriseReportRow[] {
  const acceptedByEnterprise = new Map(getAcceptedReports(reports).map((report) => [report.enterpriseId, report]));
  return enterprises.map((enterprise) => {
    const acceptedReport = acceptedByEnterprise.get(enterprise.id);
    return {
      enterprise,
      reports: acceptedReport ? [acceptedReport] : [],
      accepted: Boolean(acceptedReport),
    };
  });
}

export function getBarangayCoverageRows(rows: EnterpriseReportRow[]): BarangayCoverageRow[] {
  const rowsByBarangay = new Map<string, BarangayCoverageRow>();
  for (const row of rows) {
    const barangay = row.enterprise.barangay || "Unassigned";
    const current = rowsByBarangay.get(barangay) ?? { barangay, accepted: 0, awaitingAcceptance: 0, total: 0 };
    current.total += 1;
    if (row.accepted) {
      current.accepted += 1;
    } else {
      current.awaitingAcceptance += 1;
    }
    rowsByBarangay.set(barangay, current);
  }
  return Array.from(rowsByBarangay.values()).sort((left, right) => left.barangay.localeCompare(right.barangay));
}

export function sumMetric(reports: IntakeReport[], metric: "entry" | "unique") {
  return reports.reduce((total, report) => total + report.metrics[metric], 0);
}

export function getCurrentAnalyticsPeriod(date = new Date()): AnalyticsPeriod {
  const monthIndex = date.getMonth();
  const month = MONTH_ORDER[monthIndex];
  const year = String(date.getFullYear());
  return {
    key: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
    label: `${month} ${year}`,
    monthIndex,
    reports: [],
    year,
  };
}

export function getTrendLabel(activeReports: IntakeReport[], comparisonPeriod?: AnalyticsPeriod) {
  if (!comparisonPeriod) return "No earlier reporting period";
  const activeEntries = sumMetric(activeReports, "entry");
  const comparisonEntries = sumMetric(getAcceptedReports(comparisonPeriod.reports), "entry");
  if (comparisonEntries === 0) return `Compared with ${comparisonPeriod.label}`;
  const difference = Math.round(((activeEntries - comparisonEntries) / comparisonEntries) * 100);
  return `${difference > 0 ? "+" : ""}${difference}% vs ${comparisonPeriod.label}`;
}

function getReportYear(report: IntakeReport) {
  const periodYear = report.period.match(/\d{4}/)?.[0];
  if (periodYear) return periodYear;
  return getDateYear(report.submittedAt) ?? getDateYear(report.submitted);
}

function getReportTime(report: IntakeReport) {
  for (const candidate of [report.submittedAt, report.submitted]) {
    if (!candidate) continue;
    const timestamp = Date.parse(candidate);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function getDateYear(value: string | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? String(new Date(timestamp).getFullYear()) : null;
}
