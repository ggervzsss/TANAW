import { describe, expect, it } from "vitest";
import type { IntakeReport, ReportEnterprise } from "@/shared/types";
import { getAcceptedReports, getAnalyticsPeriods, getBarangayCoverageRows, getCurrentAnalyticsPeriod, getEnterpriseReportRows, sumMetric } from "./reportAnalytics";

describe("Staff report analytics", () => {
  it("builds periods without mutating or duplicating the memoized current period", () => {
    const current = getCurrentAnalyticsPeriod(new Date("2026-07-13T00:00:00Z"));
    const reports = [report("accepted", "Ready to Consolidate", "2026-07-01T00:00:00Z")];

    const first = getAnalyticsPeriods(reports, current);
    const second = getAnalyticsPeriods(reports, current);

    expect(current.reports).toEqual([]);
    expect(first[0].reports).toHaveLength(1);
    expect(second[0].reports).toHaveLength(1);
  });

  it("excludes Pending and Returned reports from accepted tourism totals", () => {
    const accepted = report("accepted", "Ready to Consolidate", "2026-07-03T00:00:00Z", 30);
    const consolidated = report("consolidated", "Consolidated", "2026-07-04T00:00:00Z", 40, "enterprise-2");
    const pending = report("pending", "Pending Review", "2026-07-05T00:00:00Z", 500, "enterprise-3");
    const returned = report("returned", "Returned", "2026-07-06T00:00:00Z", 600, "enterprise-4");

    const eligible = getAcceptedReports([accepted, consolidated, pending, returned]);

    expect(eligible.map((item) => item.id)).toEqual(["accepted", "consolidated"]);
    expect(sumMetric(eligible, "entry")).toBe(70);
  });

  it("uses only the latest accepted record for an enterprise and marks current-registry coverage", () => {
    const enterprises: ReportEnterprise[] = [enterprise("enterprise-1"), enterprise("enterprise-2")];
    const older = report("older", "Ready to Consolidate", "2026-07-01T00:00:00Z", 10);
    const newer = report("newer", "Consolidated", "2026-07-02T00:00:00Z", 20);

    const rows = getEnterpriseReportRows(enterprises, [newer, older]);
    const coverage = getBarangayCoverageRows(rows);

    expect(rows[0].reports.map((item) => item.id)).toEqual(["newer"]);
    expect(rows[0].accepted).toBe(true);
    expect(rows[1].accepted).toBe(false);
    expect(coverage).toEqual([{ barangay: "Poblacion", accepted: 1, awaitingAcceptance: 1, total: 2 }]);
  });
});

function report(id: string, status: IntakeReport["status"], submittedAt: string, entry = 10, enterpriseId = "enterprise-1"): IntakeReport {
  return {
    id,
    enterpriseId,
    enterprise: enterpriseId,
    category: "Hotel",
    barangay: "Poblacion",
    month: "July",
    period: "July 2026",
    submitted: submittedAt,
    submittedAt,
    status,
    code: id,
    metrics: { entry, exit: 0, unique: entry, peak: String(entry) },
  };
}

function enterprise(id: string): ReportEnterprise {
  return { id, name: id, category: "Hotel", barangay: "Poblacion", complianceOwner: "Staff" };
}
