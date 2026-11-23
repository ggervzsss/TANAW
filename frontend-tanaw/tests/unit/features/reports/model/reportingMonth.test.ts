import { describe, expect, it } from "vitest";
import { compareMonths, formatReportingMonth, intakeReportMonth, monthKey, parseApiDate, parseMonthKey, parseReportingPeriod, reportingMonthOptions } from "@/features/reports/model/reportingMonth";
import type { IntakeReport } from "@/shared/types";

function report(month: string, period: string, submittedAt = "2026-11-02T09:00:00+08:00") {
  return { month, period, submittedAt, submitted: submittedAt } as IntakeReport;
}

describe("reporting months", () => {
  it("round-trips the URL key and reads stored periods", () => {
    expect(monthKey({ month: "October", year: 2026 })).toBe("2026-10");
    expect(parseMonthKey("2026-01")).toEqual({ month: "January", year: 2026 });
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("October")).toBeNull();
    expect(parseReportingPeriod(" december 2025 ")).toEqual({ month: "December", year: 2025 });
    expect(parseReportingPeriod("Q4 2025")).toBeNull();
    expect(formatReportingMonth({ month: "May", year: 2026 })).toBe("May 2026");
    expect(compareMonths({ month: "December", year: 2025 }, { month: "January", year: 2026 })).toBeLessThan(0);
  });

  it("takes a report's year from its period, or from when it was sent", () => {
    expect(intakeReportMonth(report("October", "October 2026"))).toEqual({ month: "October", year: 2026 });
    expect(intakeReportMonth(report("December", "Month report", "2027-01-04T09:00:00+08:00"))).toEqual({ month: "December", year: 2027 });
    expect(intakeReportMonth(report("", "September 2026"))).toEqual({ month: "September", year: 2026 });
  });

  it("offers the months that have reports and the current reporting month, newest first", () => {
    const options = reportingMonthOptions([report("September", "September 2026"), report("September", "September 2026"), report("December", "December 2025")], { month: "October", year: 2026 });
    expect(options.map(monthKey)).toEqual(["2026-10", "2026-09", "2025-12"]);
  });

  it("reads a date-only API value as that local day", () => {
    expect(parseApiDate("2026-11-03")?.toDateString()).toBe(new Date(2026, 10, 3).toDateString());
    expect(parseApiDate("not a date")).toBeNull();
    expect(parseApiDate(undefined)).toBeNull();
  });
});
