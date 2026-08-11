import type { IntakeReport, ReportEnterprise } from "@/shared/types";

const MONTH_ORDER = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export type AnalyticsPeriod = { key: string; label: string; monthIndex: number; reports: IntakeReport[]; year: string };
export type EnterpriseReportRow = { enterprise: ReportEnterprise; reports: IntakeReport[]; submitted: boolean };
export type EnterpriseTrafficRow = { entries: number; name: string; status: "Missing" | "Submitted"; unique: number };
export type BarangayComplianceRow = { barangay: string; complete: number; pending: number; total: number };

export function getCurrentAnalyticsPeriod(date = new Date()): AnalyticsPeriod {
  const monthIndex = date.getMonth();
  const year = String(date.getFullYear());
  return { key: `${year}-${String(monthIndex + 1).padStart(2, "0")}`, label: `${MONTH_ORDER[monthIndex]} ${year}`, monthIndex, reports: [], year };
}

export function getAnalyticsPeriods(reports: IntakeReport[], currentPeriod: AnalyticsPeriod) {
  const periods = new Map<string, AnalyticsPeriod>([[currentPeriod.key, currentPeriod]]);
  reports.forEach((report) => {
    const year = getReportYear(report);
    const monthIndex = MONTH_ORDER.indexOf(report.month);
    if (!year || monthIndex === -1) return;
    const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    const period = periods.get(key) ?? { key, label: `${report.month} ${year}`, monthIndex, reports: [], year };
    period.reports.push(report);
    periods.set(key, period);
  });
  return Array.from(periods.values()).sort((left, right) => Number(right.year) - Number(left.year) || right.monthIndex - left.monthIndex);
}

export function sumReportMetric(reports: IntakeReport[], metric: "entry" | "unique") {
  return reports.reduce((total, report) => total + report.metrics[metric], 0);
}

export function getTrendLabel(activeReports: IntakeReport[], comparisonPeriod?: AnalyticsPeriod) {
  if (!comparisonPeriod) return "No earlier reporting period";
  const activeEntries = sumReportMetric(activeReports, "entry");
  const comparisonEntries = sumReportMetric(comparisonPeriod.reports, "entry");
  if (comparisonEntries === 0) return `Compared with ${comparisonPeriod.label}`;
  const difference = Math.round(((activeEntries - comparisonEntries) / comparisonEntries) * 100);
  return `${difference > 0 ? "+" : ""}${difference}% vs ${comparisonPeriod.label}`;
}

export function getEnterpriseReportRows(enterprises: ReportEnterprise[], reports: IntakeReport[]): EnterpriseReportRow[] {
  const reportsByEnterprise = reports.reduce<Map<string, IntakeReport[]>>((map, report) => {
    const items = map.get(report.enterpriseId) ?? [];
    items.push(report);
    map.set(report.enterpriseId, items);
    return map;
  }, new Map());
  return enterprises.map((enterprise) => {
    const enterpriseReports = reportsByEnterprise.get(enterprise.id) ?? [];
    return { enterprise, reports: enterpriseReports, submitted: enterpriseReports.some((report) => report.submitted !== "Not submitted") };
  });
}

export function getBarangayComplianceRows(rows: EnterpriseReportRow[]): BarangayComplianceRow[] {
  const byBarangay = rows.reduce<Map<string, BarangayComplianceRow>>((map, row) => {
    const barangay = row.enterprise.barangay || "Unassigned";
    const current = map.get(barangay) ?? { barangay, complete: 0, pending: 0, total: 0 };
    current.total += 1;
    if (row.submitted) current.complete += 1;
    else current.pending += 1;
    map.set(barangay, current);
    return map;
  }, new Map());
  return Array.from(byBarangay.values()).sort((left, right) => left.barangay.localeCompare(right.barangay));
}

export function getEnterpriseTrafficRows(rows: EnterpriseReportRow[]): EnterpriseTrafficRow[] {
  return rows.map(({ enterprise, reports, submitted }) => ({
    entries: sumReportMetric(reports, "entry"),
    name: enterprise.name,
    status: submitted ? "Submitted" : "Missing",
    unique: sumReportMetric(reports, "unique"),
  }));
}

export function getCompliancePercentage(complete: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((complete / total) * 100)));
}

function getReportYear(report: IntakeReport) {
  return report.period.match(/\d{4}/)?.[0] ?? getDateYear(report.submittedAt) ?? getDateYear(report.submitted);
}

function getDateYear(value: string | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? String(new Date(timestamp).getFullYear()) : null;
}
