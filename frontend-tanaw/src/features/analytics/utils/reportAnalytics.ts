import type { EnterpriseReportListItem, PeriodComplianceResource, ReportingPeriodDiscoveryResource } from "@/shared/types";
import { decimalToChartNumber, sumDecimals } from "@/features/reports/utils/decimal";
import { metricFact, officialAnalyticsReports } from "@/features/reports/utils/reportWorkflow";

export type EnterpriseMetricRow = {
  enterpriseId: string;
  enterpriseName: string;
  reports: EnterpriseReportListItem[];
  entriesExact: string | null;
  uniqueEstimateExact: string | null;
  entriesChart: number | null;
  uniqueEstimateChart: number | null;
};

export type BarangayCoverageRow = {
  barangay: string;
  accepted: number;
  awaitingAcceptance: number;
  total: number;
};

export function getComparisonPeriod(periods: ReportingPeriodDiscoveryResource[], reportingPeriodId: string) {
  const activeIndex = periods.findIndex((period) => period.reportingPeriodId === reportingPeriodId);
  return activeIndex >= 0 ? periods[activeIndex + 1] : undefined;
}

export function getEnterpriseMetricRows(reports: EnterpriseReportListItem[], reportingPeriodId: string) {
  const grouped = new Map<string, EnterpriseReportListItem[]>();
  for (const report of officialAnalyticsReports(reports, reportingPeriodId)) {
    grouped.set(report.enterprise.enterpriseId, [...(grouped.get(report.enterprise.enterpriseId) ?? []), report]);
  }
  return Array.from(grouped.entries())
    .map(([enterpriseId, enterpriseReports]): EnterpriseMetricRow => {
      const entriesExact = sumMetric(enterpriseReports, "entries");
      const uniqueEstimateExact = sumMetric(enterpriseReports, "unique_visitor_estimate");
      return {
        enterpriseId,
        enterpriseName: enterpriseReports[0]?.enterprise.enterpriseName ?? enterpriseId,
        reports: enterpriseReports,
        entriesExact,
        uniqueEstimateExact,
        entriesChart: decimalToChartNumber(entriesExact),
        uniqueEstimateChart: decimalToChartNumber(uniqueEstimateExact),
      };
    })
    .sort((left, right) => left.enterpriseName.localeCompare(right.enterpriseName));
}

export function getBarangayCoverageRows(compliance: PeriodComplianceResource | null): BarangayCoverageRow[] {
  if (!compliance) return [];
  const byBarangay = new Map<string, BarangayCoverageRow>();
  for (const obligation of compliance.obligations) {
    if (obligation.classification !== "official" || obligation.eligibilityStatus !== "eligible") continue;
    const barangay = obligation.frozenBarangay ?? "Not recorded";
    const current = byBarangay.get(barangay) ?? { barangay, accepted: 0, awaitingAcceptance: 0, total: 0 };
    current.total += 1;
    if (obligation.complianceStatus === "accepted" || obligation.complianceStatus === "consolidated") current.accepted += 1;
    else current.awaitingAcceptance += 1;
    byBarangay.set(barangay, current);
  }
  return Array.from(byBarangay.values()).sort((left, right) => left.barangay.localeCompare(right.barangay));
}

export function sumMetric(reports: EnterpriseReportListItem[], definition: string) {
  const values = reports.map((report) => metricFact(report, definition)?.value ?? null);
  return values.length === 0 ? null : sumDecimals(values);
}

export function getTrendLabel(
  activeReports: EnterpriseReportListItem[],
  comparisonPeriod?: ReportingPeriodDiscoveryResource,
  comparisonReports: EnterpriseReportListItem[] = [],
) {
  if (!comparisonPeriod) return "No earlier server reporting period";
  const active = decimalToChartNumber(sumMetric(activeReports, "entries"));
  const includedComparisonReports = officialAnalyticsReports(comparisonReports, comparisonPeriod.reportingPeriodId);
  const comparison = decimalToChartNumber(sumMetric(includedComparisonReports, "entries"));
  if (active === null || comparison === null || comparison === 0) return `Compared with ${comparisonPeriod.label}; exact percentage unavailable`;
  const difference = Math.round(((active - comparison) / comparison) * 100);
  return `${difference > 0 ? "+" : ""}${difference}% vs ${comparisonPeriod.label}`;
}
