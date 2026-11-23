import { describe, expect, it } from "vitest";
import {
  annualReportRows,
  consolidatedReportYears,
  defaultConsolidatedYear,
  enterpriseCoverage,
  finalReportStatus,
  formatGeneratedOn,
  monthlyReportsForYear,
  parseConsolidatedTab,
} from "@/features/reports/model/consolidatedReports";
import type { FinalReport } from "@/shared/types";

function finalReport(id: string, period: string, status: FinalReport["status"] = "Finalized", generatedOn = "2026-10-09", unique = 100): FinalReport {
  return {
    id,
    period,
    status,
    generatedOn,
    title: "Citywide Tourism Aggregation",
    preparedBy: "Staff",
    preparedRole: "Staff Processing Division",
    enterpriseCount: 1,
    totalEntry: null,
    totalExit: null,
    totalUnique: unique,
    sources: [{ id: `${id}-source`, enterpriseProfileId: "park", attractionCode: "411", enterprise: "Park", code: "RPT", unique, entry: null, exit: null }],
  };
}

describe("monthly consolidated reports", () => {
  const reports = [
    finalReport("SEP", "September 2026"),
    finalReport("OCT-OLD", "October 2026", "Archived", "2026-11-05"),
    finalReport("OCT", "October 2026", "Draft", "2026-11-12"),
    finalReport("DEC-25", "December 2025", "Finalized", "2026-01-12"),
  ];

  it("lists one year, latest month first and a month's newer report first", () => {
    expect(monthlyReportsForYear(reports, 2026).map((report) => report.id)).toEqual(["OCT", "OCT-OLD", "SEP"]);
    expect(monthlyReportsForYear(reports, 2024)).toEqual([]);
  });

  it("offers every year with a report and the current year, and opens on the newest", () => {
    expect(consolidatedReportYears(reports, 2027)).toEqual([2027, 2026, 2025]);
    expect(defaultConsolidatedYear(reports, 2027)).toBe(2026);
    expect(defaultConsolidatedYear([], 2027)).toBe(2027);
  });

  it("shows finalized reports as Consolidated and keeps the other stored statuses honest", () => {
    expect(finalReportStatus("Finalized")).toEqual({ label: "Consolidated", tone: "consolidated" });
    expect(finalReportStatus("Draft")).toEqual({ label: "Draft", tone: "pending" });
    expect(finalReportStatus("Archived").label).toBe("Archived");
  });

  it("formats coverage and dates", () => {
    expect(enterpriseCoverage(11, 12)).toBe("11 of 12");
    expect(enterpriseCoverage(11, 9)).toBe("11");
    expect(enterpriseCoverage(3, null)).toBe("3");
    expect(formatGeneratedOn("2026-10-09")).toBe("Oct 9, 2026");
    expect(parseConsolidatedTab("annual")).toBe("annual");
    expect(parseConsolidatedTab("other")).toBe("monthly");
  });
});

describe("annual consolidated reports", () => {
  it("adds up each year's finalized months and is complete at 12", () => {
    const year2025 = Array.from({ length: 12 }, (_, index) => finalReport(`M${index}`, `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][index]} 2025`, "Finalized", "2026-01-01", 10));
    const rows = annualReportRows([...year2025, finalReport("SEP", "September 2026", "Finalized", "2026-10-09", 70), finalReport("OCT", "October 2026", "Draft", "2026-11-09", 50)]);
    expect(rows).toEqual([
      { year: 2026, monthsIncluded: 1, visitors: 70, complete: false },
      { year: 2025, monthsIncluded: 12, visitors: 120, complete: true },
    ]);
  });
});
