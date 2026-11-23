import { describe, expect, it } from "vitest";
import { listNames, parseStaffReportsTab, rowInTab, staffReportRows, staffReportsProgress, staffReportsStatus, staffReportTabs } from "@/features/reports/model/staffReports";
import type { IntakeReport, ReportEnterprise } from "@/shared/types";

const october = { month: "October", year: 2026 } as const;
const afterDue = new Date(2026, 10, 24);
const beforeDue = new Date(2026, 10, 5);

function enterprise(id: string, name: string, barangay = "Poblacion"): ReportEnterprise {
  return { id, name, barangay, category: "Tourism", complianceOwner: "Owner" };
}

function report(enterpriseId: string, status: IntakeReport["status"], overrides: Partial<IntakeReport> = {}): IntakeReport {
  return {
    id: `r-${enterpriseId}`,
    code: `RPT-2026-10-${enterpriseId}`,
    enterpriseId,
    enterprise: enterpriseId,
    barangay: "Poblacion",
    month: "October",
    period: "October 2026",
    status,
    submitted: "2026-11-09",
    submittedAt: "2026-11-09T09:00:00+08:00",
    ...overrides,
  } as IntakeReport;
}

const enterprises = [enterprise("a", "Acacia Park"), enterprise("b", "Balon ni Lolo"), enterprise("c", "City Plaza"), enterprise("d", "Daisy Resort"), enterprise("e", "Echo Mall")];

describe("staff report rows", () => {
  it("gives each enterprise its month's report, status, note and one action, work to do first", () => {
    const reports = [
      report("a", "Consolidated"),
      report("b", "Pending Review", { submittedAt: "2026-11-13T10:00:00+08:00" }),
      report("c", "Returned"),
      report("e", "Ready to Consolidate"),
      report("a", "Pending Review", { id: "older-month", month: "September", period: "September 2026" }),
    ];
    const rows = staffReportRows(enterprises, reports, october, afterDue);

    expect(rows.map((row) => [row.name, row.submission, row.review, row.action])).toEqual([
      ["Balon ni Lolo", "Submitted", "Waiting", "review"],
      ["Daisy Resort", "Missing", "Waiting", "remind"],
      ["City Plaza", "Submitted", "Reviewing", "view"],
      ["Acacia Park", "Submitted", "Consolidated", "view"],
      ["Echo Mall", "Submitted", "Consolidated", "view"],
    ]);
    expect(rows[0]).toMatchObject({ sent: "Nov 13", note: "3 days after due", report: { id: "r-b" } });
    expect(rows[1]).toMatchObject({ sent: null, note: "14 days overdue", report: undefined });
    expect(rows[2].note).toBe("Returned for correction");
  });

  it("keeps a report from an enterprise that is no longer registered, and uses its newest report", () => {
    const reports = [report("x", "Pending Review", { enterprise: "Old Museum", barangay: "Nueva" }), report("a", "Returned", { id: "first", submittedAt: "2026-11-02T09:00:00+08:00" }), report("a", "Pending Review", { id: "resent" })];
    const rows = staffReportRows([enterprise("a", "Acacia Park")], reports, october, afterDue);
    expect(rows.find((row) => row.enterpriseId === "x")).toMatchObject({ name: "Old Museum", barangay: "Nueva", action: "review" });
    expect(rows.find((row) => row.enterpriseId === "a")?.report?.id).toBe("resent");
  });
});

describe("staff report tabs", () => {
  it("counts each view and labels the not-sent tab after its rows' status", () => {
    const reports = [report("a", "Pending Review"), report("b", "Returned"), report("c", "Ready to Consolidate")];
    const after = staffReportRows(enterprises, reports, october, afterDue);
    expect(staffReportTabs(after).map(({ label, count }) => [label, count])).toEqual([
      ["All", 5],
      ["Waiting", 1],
      ["Reviewing", 1],
      ["Consolidated", 1],
      ["Missing", 2],
    ]);
    const before = staffReportRows(enterprises, reports, october, beforeDue);
    expect(staffReportTabs(before).at(-1)).toEqual({ value: "not-sent", label: "Pending", count: 2 });
    expect(before.filter((row) => rowInTab(row, "waiting")).map((row) => row.name)).toEqual(["Acacia Park"]);
  });

  it("falls back to All for an unknown tab", () => {
    expect(parseStaffReportsTab("reviewing")).toBe("reviewing");
    expect(parseStaffReportsTab("nope")).toBe("all");
    expect(parseStaffReportsTab(null)).toBe("all");
  });
});

describe("generating the consolidated report", () => {
  it("waits while any received report is waiting or returned", () => {
    const rows = staffReportRows(enterprises, [report("a", "Pending Review"), report("b", "Returned"), report("c", "Ready to Consolidate")], october, afterDue);
    const progress = staffReportsProgress(rows);
    expect(progress).toMatchObject({ received: 3, consolidated: 1, reviewing: 1, waiting: 1, readyReportIds: ["r-c"], canGenerate: false, generated: false });
    expect(staffReportsStatus(progress, october)).toEqual({
      line: "1 of 3 received reports consolidated.",
      detail: "1 reviewing, 1 waiting. Generate once all 3 are consolidated. Daisy Resort and Echo Mall have not sent reports.",
    });
  });

  it("is ready once every received report is accepted, even when some enterprises have not sent one", () => {
    const rows = staffReportRows(enterprises, [report("a", "Ready to Consolidate"), report("b", "Consolidated")], october, beforeDue);
    const progress = staffReportsProgress(rows);
    expect(progress).toMatchObject({ canGenerate: true, readyReportIds: ["r-a"] });
    expect(staffReportsStatus(progress, october).detail).toBe("Ready to generate the consolidated report. City Plaza, Daisy Resort and Echo Mall have not sent reports yet.");
  });

  it("has nothing to generate when every received report is already in a monthly report, or none arrived", () => {
    const done = staffReportsProgress(staffReportRows([enterprise("a", "Acacia Park")], [report("a", "Consolidated")], october, afterDue));
    expect(done).toMatchObject({ canGenerate: false, generated: true });
    expect(staffReportsStatus(done, october)).toEqual({ line: "1 of 1 received report consolidated.", detail: "The consolidated report for this month has been generated." });

    const none = staffReportsProgress(staffReportRows([enterprise("d", "Daisy Resort")], [], october, afterDue));
    expect(none.canGenerate).toBe(false);
    expect(staffReportsStatus(none, october)).toEqual({ line: "No October 2026 reports received yet.", detail: "Daisy Resort has not sent a report." });
  });

  it("lists names in plain English", () => {
    expect(listNames(["A"])).toBe("A");
    expect(listNames(["A", "B"])).toBe("A and B");
    expect(listNames(["A", "B", "C", "D", "E"])).toBe("A, B, C and 2 more");
  });
});
