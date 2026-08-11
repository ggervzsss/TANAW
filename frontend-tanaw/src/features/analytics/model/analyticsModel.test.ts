import { describe, expect, it } from "vitest";
import type { IntakeReport, ReportEnterprise } from "@/shared/types";
import { getCompliancePercentage, getEnterpriseTrafficRows, type EnterpriseReportRow } from "./analyticsModel";

const enterprises: ReportEnterprise[] = [
  { id: "enterprise-b", name: "Balon ni Lolo Uweng", category: "Attraction", barangay: "Landayan", complianceOwner: "Owner B" },
  { id: "enterprise-a", name: "Archie's Event Place", category: "Events Place", barangay: "Nueva", complianceOwner: "Owner A" },
];

function report(id: string, enterprise: ReportEnterprise, entry: number, unique: number): IntakeReport {
  return {
    id,
    enterpriseId: enterprise.id,
    enterprise: enterprise.name,
    category: enterprise.category,
    barangay: enterprise.barangay,
    month: "June",
    period: "June 2026",
    submitted: "2026-06-30",
    status: "Consolidated",
    code: id,
    metrics: { entry, exit: entry, unique, peak: "12:00 PM" },
  };
}

describe("staff analytics presentation model", () => {
  it("preserves business order and totals actual report values for the enterprise comparison", () => {
    const rows: EnterpriseReportRow[] = [
      { enterprise: enterprises[0], reports: [report("report-b1", enterprises[0], 420, 280), report("report-b2", enterprises[0], 80, 45)], submitted: true },
      { enterprise: enterprises[1], reports: [], submitted: false },
    ];

    expect(getEnterpriseTrafficRows(rows)).toEqual([
      { name: "Balon ni Lolo Uweng", entries: 500, unique: 325, status: "Submitted" },
      { name: "Archie's Event Place", entries: 0, unique: 0, status: "Missing" },
    ]);
  });

  it("derives bounded compliance progress and handles an empty total safely", () => {
    expect(getCompliancePercentage(2, 2)).toBe(100);
    expect(getCompliancePercentage(1, 3)).toBe(33);
    expect(getCompliancePercentage(0, 0)).toBe(0);
    expect(getCompliancePercentage(4, 3)).toBe(100);
  });
});
