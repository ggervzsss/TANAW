import type {
  EnterpriseReportListItem,
  ObligationResource,
  PeriodComplianceResource,
  ReportMetricFactResource,
} from "@/shared/types";

export type ComplianceRow = {
  obligation: ObligationResource;
  report: EnterpriseReportListItem | null;
  enterpriseLabel: string;
  siteLabel: string;
};

export function buildComplianceRows(compliance: PeriodComplianceResource, reports: EnterpriseReportListItem[]): ComplianceRow[] {
  const reportsById = new Map(reports.map((report) => [report.enterpriseReportId, report]));
  return compliance.obligations
    .filter((obligation) => obligation.classification === "official")
    .map((obligation) => {
      const report = obligation.enterpriseReportId ? (reportsById.get(obligation.enterpriseReportId) ?? null) : null;
      return {
        obligation,
        report,
        enterpriseLabel: `${obligation.enterpriseName} (${obligation.enterpriseOfficialCode})`,
        siteLabel: `${obligation.siteName} (${obligation.siteCode})`,
      };
    })
    .sort((left, right) => left.enterpriseLabel.localeCompare(right.enterpriseLabel) || left.siteLabel.localeCompare(right.siteLabel));
}

export function officialAnalyticsReports(reports: EnterpriseReportListItem[], reportingPeriodId: string) {
  const selected = reports.filter(
    (report) =>
      report.classification === "official" &&
      report.reportingPeriod.reportingPeriodId === reportingPeriodId &&
      report.includedInOfficialTotals &&
      (report.workflowState === "accepted" || report.workflowState === "consolidated") &&
      report.currentRevision.isAccepted,
  );
  const unique = new Map<string, EnterpriseReportListItem>();
  for (const report of selected) unique.set(report.enterpriseReportId, report);
  return Array.from(unique.values());
}

export function metricFact(report: EnterpriseReportListItem, definition: string): ReportMetricFactResource | null {
  return report.currentRevision.metrics.find((metric) => metric.definition === definition) ?? null;
}

export function acceptedRevisionIds(reports: EnterpriseReportListItem[]) {
  return reports
    .map((report) => report.acceptedRevisionId)
    .filter((revisionId): revisionId is string => Boolean(revisionId))
    .sort((left, right) => left.localeCompare(right));
}

export function reportMatchesScope(report: EnterpriseReportListItem, scope: { type: "citywide" | "barangay" | "enterprise_selection"; barangay: string | null }, selectedIds: Set<string>) {
  if (scope.type === "citywide") return true;
  if (scope.type === "barangay") return report.site.frozenBarangay === scope.barangay;
  return selectedIds.has(report.enterpriseReportId);
}

export function readableToken(value: string) {
  return value.replaceAll("_", " ");
}
