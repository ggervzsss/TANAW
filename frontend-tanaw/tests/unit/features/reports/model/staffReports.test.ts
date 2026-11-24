import { describe, expect, it } from "vitest";
import {
  EMPTY_STAFF_REPORT_FILTERS,
  filterStaffReportRows,
  hasStaffReportFilters,
  parseStaffReportFilters,
  staffReportFilterOptions,
  staffReportFilterParams,
  staffReportRows,
  staffReportsProgress,
  staffReportsSummary,
} from "@/features/reports/model/staffReports";
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

describe("staff report filters", () => {
  const enterprisesByBarangay = [enterprise("a", "Acacia Park"), enterprise("b", "Balon ni Lolo", "Landayan"), enterprise("c", "City Plaza"), enterprise("d", "Daisy Resort", "Landayan"), enterprise("e", "Echo Mall")];
  const reports = [report("a", "Pending Review"), report("b", "Returned"), report("c", "Ready to Consolidate")];
  const rows = staffReportRows(enterprisesByBarangay, reports, october, afterDue);
  const names = (filters: Partial<typeof EMPTY_STAFF_REPORT_FILTERS>) => filterStaffReportRows(rows, { ...EMPTY_STAFF_REPORT_FILTERS, ...filters }).map((row) => row.name);

  it("searches names, barangays and report IDs", () => {
    expect(names({ query: "plaza" })).toEqual(["City Plaza"]);
    expect(names({ query: "landayan" })).toEqual(["Daisy Resort", "Balon ni Lolo"]);
    expect(names({ query: "RPT-2026-10-a" })).toEqual(["Acacia Park"]);
  });

  it("filters by submission, staff review and barangay together", () => {
    expect(names({ submission: "Missing" })).toEqual(["Daisy Resort", "Echo Mall"]);
    expect(names({ review: "Waiting" })).toEqual(["Acacia Park"]);
    expect(names({ review: "Reviewing" })).toEqual(["Balon ni Lolo"]);
    expect(names({ submission: "Missing", barangay: "Landayan" })).toEqual(["Daisy Resort"]);
  });

  it("counts what each option would show alongside the other filters", () => {
    const options = staffReportFilterOptions(rows, { ...EMPTY_STAFF_REPORT_FILTERS, barangay: "Landayan" });
    expect(options.submission.map(({ label, meta }) => [label, meta])).toEqual([
      ["All submissions", "2"],
      ["Submitted", "1"],
      ["Pending", "0"],
      ["Missing", "1"],
    ]);
    expect(options.barangay.map(({ value }) => value)).toEqual(["all", "Landayan", "Poblacion"]);
  });

  it("reads and writes the filters in the address", () => {
    const filters = parseStaffReportFilters(new URLSearchParams("q=plaza&submission=missing&review=WAITING&barangay=Landayan"));
    expect(filters).toEqual({ query: "plaza", submission: "Missing", review: "Waiting", barangay: "Landayan" });
    expect(staffReportFilterParams(filters)).toEqual({ q: "plaza", submission: "missing", review: "waiting", barangay: "Landayan" });
    expect(parseStaffReportFilters(new URLSearchParams("submission=nope"))).toEqual(EMPTY_STAFF_REPORT_FILTERS);
    expect(staffReportFilterParams(EMPTY_STAFF_REPORT_FILTERS)).toEqual({ q: null, submission: null, review: null, barangay: null });
    expect(hasStaffReportFilters(EMPTY_STAFF_REPORT_FILTERS)).toBe(false);
    expect(hasStaffReportFilters(filters)).toBe(true);
  });
});

describe("generating the consolidated report", () => {
  it("waits while any received report is waiting or returned", () => {
    const rows = staffReportRows(enterprises, [report("a", "Pending Review"), report("b", "Returned"), report("c", "Ready to Consolidate")], october, afterDue);
    const progress = staffReportsProgress(rows);
    expect(progress).toMatchObject({ received: 3, consolidated: 1, reviewing: 1, waiting: 1, readyReportIds: ["r-c"], canGenerate: false, generated: false });
    expect(staffReportsSummary(progress, october)).toBe("1 of 3 received reports consolidated. Generate once all 3 are.");
  });

  it("is ready once every received report is accepted, even when some enterprises have not sent one", () => {
    const rows = staffReportRows(enterprises, [report("a", "Ready to Consolidate"), report("b", "Consolidated")], october, beforeDue);
    const progress = staffReportsProgress(rows);
    expect(progress).toMatchObject({ canGenerate: true, readyReportIds: ["r-a"] });
    expect(staffReportsSummary(progress, october)).toBe("All 2 received reports are consolidated. Ready to generate.");
  });

  it("has nothing to generate when every received report is already in a monthly report, or none arrived", () => {
    const done = staffReportsProgress(staffReportRows([enterprise("a", "Acacia Park")], [report("a", "Consolidated")], october, afterDue));
    expect(done).toMatchObject({ canGenerate: false, generated: true });
    expect(staffReportsSummary(done, october)).toBe("The consolidated report for this month has been generated.");

    const none = staffReportsProgress(staffReportRows([enterprise("d", "Daisy Resort")], [], october, afterDue));
    expect(none.canGenerate).toBe(false);
    expect(staffReportsSummary(none, october)).toBe("No October 2026 reports received yet.");
  });
});
