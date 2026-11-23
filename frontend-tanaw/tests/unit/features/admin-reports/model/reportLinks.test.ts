import { describe, expect, it } from "vitest";
import { adminEnterpriseReportPath, readReportLink, withReportClosed, withReportMonth, withReportOpen } from "../../../../../src/features/admin-reports/model/reportLinks";
import { monthFromKeyId, monthKeyId, parseMonthParams, reportMonthOf } from "../../../../../src/features/admin-reports/model/reportMonths";

describe("Enterprise Reports links", () => {
  it("builds a link to one enterprise's report details on a month", () => {
    expect(adminEnterpriseReportPath("ENT 7", { year: 2026, monthIndex: 9 })).toBe("/admin/reports?enterprise=ENT+7&month=October&year=2026");
    expect(adminEnterpriseReportPath("ENT-7")).toBe("/admin/reports?enterprise=ENT-7");
  });

  it("reads the enterprise and month from the address", () => {
    expect(readReportLink(new URLSearchParams("enterprise=ENT-7&month=october&year=2025"))).toEqual({ enterpriseId: "ENT-7", month: { year: 2025, monthIndex: 9 } });
    expect(readReportLink(new URLSearchParams("month=Smarch&year=2025"))).toEqual({ enterpriseId: null, month: null });
    expect(readReportLink(new URLSearchParams("enterprise=&month=May&year=20"))).toEqual({ enterpriseId: null, month: null });
  });

  it("opens and closes the details while keeping other parameters", () => {
    const opened = withReportOpen(new URLSearchParams("tab=x"), "ENT-7", { year: 2026, monthIndex: 0 });
    expect(opened.toString()).toBe("tab=x&enterprise=ENT-7&month=January&year=2026");
    expect(withReportClosed(opened).toString()).toBe("tab=x&month=January&year=2026");
    expect(withReportMonth(new URLSearchParams("enterprise=ENT-7"), { year: 2025, monthIndex: 11 }).toString()).toBe("enterprise=ENT-7&month=December&year=2025");
  });
});

describe("report months", () => {
  it("round-trips month ids", () => {
    expect(monthKeyId({ year: 2026, monthIndex: 0 })).toBe("2026-01");
    expect(monthFromKeyId("2026-10")).toEqual({ year: 2026, monthIndex: 9 });
    expect(monthFromKeyId("2026-13")).toBeNull();
    expect(monthFromKeyId(null)).toBeNull();
    expect(parseMonthParams("May", "2026")).toEqual({ year: 2026, monthIndex: 4 });
  });

  it("reads a report's month from its period, or from when it was sent", () => {
    expect(reportMonthOf({ month: "October", period: "October 2026", submitted: "", submittedAt: "2026-11-02T08:00:00" })).toEqual({ year: 2026, monthIndex: 9 });
    expect(reportMonthOf({ month: "October", period: "October", submitted: "", submittedAt: "2025-11-02T08:00:00" })).toEqual({ year: 2025, monthIndex: 9 });
    expect(reportMonthOf({ month: "Unknown", period: "2026", submitted: "", submittedAt: "2026-11-02T08:00:00" })).toBeNull();
  });
});
