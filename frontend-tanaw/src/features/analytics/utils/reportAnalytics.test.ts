import { describe, expect, it } from "vitest";
import { complianceFixture, enterpriseReportFixture, periodFixture } from "@/features/reports/testFixtures";
import { getBarangayCoverageRows, getComparisonPeriod, getEnterpriseMetricRows, sumMetric } from "./reportAnalytics";

describe("official report analytics", () => {
  it("excludes submitted and returned reports and deduplicates repeated resources", () => {
    const accepted = enterpriseReportFixture();
    const submitted = enterpriseReportFixture({ enterpriseReportId: "submitted-report", workflowState: "submitted", includedInOfficialTotals: false, acceptedRevisionId: null, currentRevision: { ...enterpriseReportFixture().currentRevision, isAccepted: false } });
    const returned = enterpriseReportFixture({ enterpriseReportId: "returned-report", workflowState: "returned", includedInOfficialTotals: false, acceptedRevisionId: null, currentRevision: { ...enterpriseReportFixture().currentRevision, isAccepted: false } });

    const rows = getEnterpriseMetricRows([accepted, accepted, submitted, returned], periodFixture.reportingPeriodId);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.reports).toHaveLength(1);
    expect(rows[0]?.entriesExact).toBe("0.100000");
  });

  it("combines each accepted site report once per enterprise without losing decimal precision", () => {
    const first = enterpriseReportFixture();
    const second = enterpriseReportFixture({
      enterpriseReportId: "accepted-site-2",
      currentRevisionId: "revision-site-2",
      acceptedRevisionId: "revision-site-2",
      site: { ...enterpriseReportFixture().site, siteId: "site-2", siteCode: "SITE-002", siteName: "Second Site" },
      currentRevision: {
        ...enterpriseReportFixture().currentRevision,
        reportRevisionId: "revision-site-2",
        metrics: enterpriseReportFixture().currentRevision.metrics.map((metric) => (metric.definition === "entries" ? { ...metric, metricFactId: "metric-site-2", value: "0.200000" } : { ...metric, metricFactId: `${metric.metricFactId}-site-2` })),
      },
    });

    const rows = getEnterpriseMetricRows([first, second], periodFixture.reportingPeriodId);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.reports).toHaveLength(2);
    expect(rows[0]?.entriesExact).toBe("0.300000");
    expect(sumMetric([first, second], "entries")).toBe("0.300000");
  });

  it("discovers only server-returned period resources and never adds the current device month", () => {
    const earlier = { ...periodFixture, reportingPeriodId: "earlier-period", naturalKey: "month:Asia/Manila:2026-06", label: "June 2026" };
    const periods = [periodFixture, earlier];

    expect(periods.map((period) => period.reportingPeriodId)).toEqual([periodFixture.reportingPeriodId, earlier.reportingPeriodId]);
    expect(getComparisonPeriod(periods, periodFixture.reportingPeriodId)).toBe(earlier);
    expect(getComparisonPeriod(periods, "device-derived-period")).toBeUndefined();
  });

  it("derives missing coverage from frozen eligible obligations", () => {
    const rows = getBarangayCoverageRows(complianceFixture());

    expect(rows).toEqual([
      { barangay: "Poblacion", accepted: 1, awaitingAcceptance: 0, total: 1 },
      { barangay: "San Jose", accepted: 0, awaitingAcceptance: 1, total: 1 },
    ]);
    expect(getBarangayCoverageRows(null)).toEqual([]);
  });
});
