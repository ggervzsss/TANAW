import type { EnterpriseReportListItem, FinalReportScopeType, ObligationResource, PeriodComplianceResource, ReportMetricFactResource, ReportingPeriodDiscoveryResource } from "@/shared/types";

export type ComplianceRow = {
  obligation: ObligationResource;
  report: EnterpriseReportListItem | null;
  enterpriseLabel: string;
  siteLabel: string;
};

export type ReportPresentationStatus = {
  badgeStatus: "not_submitted" | "submitted" | "returned" | "accepted" | "consolidated" | "unknown" | "ineligible";
  label: string;
};

export function reportPresentationStatus({ obligation, report }: ComplianceRow): ReportPresentationStatus {
  if (obligation.eligibilityStatus === "unknown") return { badgeStatus: "unknown", label: "Needs setup" };
  if (obligation.eligibilityStatus === "exempt" || obligation.eligibilityStatus === "ineligible") {
    return { badgeStatus: "ineligible", label: "Not required" };
  }
  if (!report || obligation.complianceStatus === "not_submitted" || obligation.complianceStatus === null) {
    return { badgeStatus: "not_submitted", label: "Not submitted" };
  }
  if (report.workflowState === "submitted") return { badgeStatus: "submitted", label: "For review" };
  if (report.workflowState === "returned") return { badgeStatus: "returned", label: "Needs changes" };
  if (report.workflowState === "consolidated") return { badgeStatus: "consolidated", label: "Included in final report" };
  return { badgeStatus: "accepted", label: "Accepted" };
}

export function actionableReportingPeriods(periods: ReportingPeriodDiscoveryResource[], now = new Date()) {
  const nowTimestamp = now.getTime();
  const hasOpenPeriod = periods.some((period) => period.status === "open");
  return periods.filter((period) => {
    const startsAt = Date.parse(period.startsAt);
    const endsAt = Date.parse(period.endsAt);
    const isCurrentMonth = Number.isFinite(nowTimestamp) && Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt <= nowTimestamp && nowTimestamp < endsAt;
    return (!hasOpenPeriod && isCurrentMonth) || period.status === "open" || hasReportingActivity(period);
  });
}

export function defaultReportingPeriodId(periods: ReportingPeriodDiscoveryResource[], requestedPeriodId: string, now = new Date()) {
  if (periods.some((period) => period.reportingPeriodId === requestedPeriodId)) return requestedPeriodId;
  const openPeriod = periods.find((period) => period.status === "open");
  if (openPeriod) return openPeriod.reportingPeriodId;
  const activePeriod = periods.find(hasReportingActivity);
  if (activePeriod) return activePeriod.reportingPeriodId;
  const nowTimestamp = now.getTime();
  const currentPeriod = periods.find((period) => Date.parse(period.startsAt) <= nowTimestamp && nowTimestamp < Date.parse(period.endsAt));
  return currentPeriod?.reportingPeriodId ?? periods[0]?.reportingPeriodId ?? "";
}

function hasReportingActivity(period: ReportingPeriodDiscoveryResource) {
  const summary = period.compliance;
  return summary.submitted + summary.returned + summary.accepted + summary.consolidated > 0;
}

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
