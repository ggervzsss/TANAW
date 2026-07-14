import type { EnterpriseReportListItem, FinalReportScopeType, ObligationResource, PeriodComplianceResource, ReportMetricFactResource } from "@/shared/types";

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

export function deriveFinalizationScope(rows: ComplianceRow[], scope: { type: FinalReportScopeType; barangay: string | null }, selectedIds: Set<string>) {
  const targetedRows = rows.filter((row) => {
    if (scope.type === "citywide") return true;
    if (scope.type === "barangay") return row.obligation.frozenBarangay === scope.barangay;
    return row.report !== null && selectedIds.has(row.report.enterpriseReportId);
  });
  const eligibleRows = targetedRows.filter((row) => row.obligation.eligibilityStatus === "eligible");
  const reports = eligibleRows.flatMap((row) =>
    row.report &&
    !row.obligation.acceptanceBlocked &&
    row.obligation.complianceStatus === "accepted" &&
    row.report.workflowState === "accepted" &&
    row.report.acceptedRevisionId !== null &&
    row.report.acceptedRevisionId === row.report.currentRevisionId &&
    row.report.currentRevision.isAccepted &&
    !row.report.acceptanceBlocked
      ? [row.report]
      : [],
  );

  if (scope.type === "enterprise_selection") {
    return {
      complete: selectedIds.size > 0 && reports.length === selectedIds.size,
      reports,
    };
  }

  return {
    complete:
      eligibleRows.length > 0 &&
      !targetedRows.some((row) => row.obligation.eligibilityStatus === "unknown") &&
      !eligibleRows.some((row) => row.obligation.acceptanceBlocked) &&
      reports.length === eligibleRows.length,
    reports,
  };
}

export function deriveBatchReportView(rows: ComplianceRow[], query: string, scope: { type: FinalReportScopeType; barangay: string | null }, selectedIds: Set<string>) {
  const needle = query.trim().toLowerCase();
  const visibleRows = needle
    ? rows.filter((row) =>
        [row.enterpriseLabel, row.siteLabel, row.obligation.enterpriseId, row.obligation.siteId, row.obligation.frozenBarangay ?? "", row.obligation.obligationId].some((value) =>
          value.toLowerCase().includes(needle),
        ),
      )
    : rows;

  return {
    ...deriveFinalizationScope(rows, scope, selectedIds),
    visibleRows,
  };
}

export function readableToken(value: string) {
  return value.replaceAll("_", " ");
}
