import { describe, expect, it } from "vitest";
import {
  activeStaffReportFilterCount,
  compareStaffReportRows,
  EMPTY_STAFF_REPORT_FILTERS,
  filterStaffReportRows,
  generateConfirmMessage,
  hasStaffReportFilters,
  parseStaffReportFilters,
  reminderButton,
  reminderFailedMessage,
  reminderSentMessage,
  staffReminder,
  staffReportFilterOptions,
  staffReportFilterParams,
  staffReportFiltersButtonLabel,
  staffReportRows,
  staffReportsCaption,
  staffReportsProgress,
  type StaffReportRow,
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
  it("gives each enterprise its month's report, status, note and one action, in submission then review order", () => {
    const reports = [
      report("a", "Consolidated"),
      report("b", "Pending Review", { submittedAt: "2026-11-13T10:00:00+08:00" }),
      report("c", "Ready to Consolidate"),
      report("e", "Ready to Consolidate"),
      report("a", "Pending Review", { id: "older-month", month: "September", period: "September 2026" }),
    ];
    const rows = staffReportRows(enterprises, reports, october, afterDue);

    expect(rows.map((row) => [row.name, row.submission, row.review, row.action])).toEqual([
      ["Daisy Resort", "Missing", "Waiting", "remind"],
      ["Balon ni Lolo", "Submitted", "Reviewing", "review"],
      ["Acacia Park", "Submitted", "Consolidated", "view"],
      ["City Plaza", "Submitted", "Consolidated", "view"],
      ["Echo Mall", "Submitted", "Consolidated", "view"],
    ]);
    expect(rows[0]).toMatchObject({ sent: null, note: "14 days overdue", report: undefined });
    expect(rows[1]).toMatchObject({ sent: "Nov 13", note: null, report: { id: "r-b" } });
    expect(rows[2]).toMatchObject({ note: null, action: "view" });
  });

  it("shows Waiting only for enterprises that have not sent a report, Pending or Missing", () => {
    const before = staffReportRows(enterprises, [report("a", "Pending Review")], october, beforeDue);
    expect(before.filter((row) => row.review === "Waiting").map((row) => row.submission)).toEqual(["Pending", "Pending", "Pending", "Pending"]);
    expect(before.find((row) => row.enterpriseId === "a")).toMatchObject({ submission: "Submitted", review: "Reviewing", action: "review" });
    const after = staffReportRows(enterprises, [], october, afterDue);
    expect(after.every((row) => row.submission === "Missing" && row.review === "Waiting")).toBe(true);
  });

  it("orders Missing, Pending, then Submitted; then Waiting, Reviewing, then Consolidated; then by name", () => {
    const row = (name: string, submission: StaffReportRow["submission"], review: StaffReportRow["review"]) => ({ name, submission, review }) as StaffReportRow;
    const rows = [
      row("Acacia Park", "Submitted", "Consolidated"),
      row("Balon ni Lolo", "Submitted", "Reviewing"),
      row("City Plaza", "Pending", "Waiting"),
      row("Daisy Resort", "Missing", "Waiting"),
      row("Echo Mall", "Submitted", "Reviewing"),
      row("Acme Hall", "Missing", "Waiting"),
    ];
    expect([...rows].sort(compareStaffReportRows).map((item) => item.name)).toEqual(["Acme Hall", "Daisy Resort", "City Plaza", "Balon ni Lolo", "Echo Mall", "Acacia Park"]);
  });

  it("keeps a report from an enterprise that is no longer registered", () => {
    const reports = [report("x", "Pending Review", { enterprise: "Old Museum", barangay: "Nueva" }), report("a", "Consolidated")];
    const rows = staffReportRows([enterprise("a", "Acacia Park")], reports, october, afterDue);
    expect(rows.find((row) => row.enterpriseId === "x")).toMatchObject({ name: "Old Museum", barangay: "Nueva", action: "review" });
    expect(rows.find((row) => row.enterpriseId === "a")).toMatchObject({ report: { id: "r-a" }, submission: "Submitted", review: "Consolidated", action: "view", remind: false });
  });

  it("offers Remind only to enterprises that have not sent their report", () => {
    const rows = staffReportRows(enterprises, [report("a", "Pending Review"), report("b", "Ready to Consolidate"), report("c", "Consolidated")], october, afterDue);
    expect(rows.filter((row) => row.remind).map((row) => row.enterpriseId)).toEqual(["d", "e"]);
    expect(rows.filter((row) => row.remind).every((row) => row.action === "remind" && row.review === "Waiting")).toBe(true);
  });
});

describe("staff report filters", () => {
  const enterprisesByBarangay = [enterprise("a", "Acacia Park"), enterprise("b", "Balon ni Lolo", "Landayan"), enterprise("c", "City Plaza"), enterprise("d", "Daisy Resort", "Landayan"), enterprise("e", "Echo Mall")];
  const reports = [report("a", "Pending Review"), report("b", "Pending Review"), report("c", "Ready to Consolidate")];
  const rows = staffReportRows(enterprisesByBarangay, reports, october, afterDue);
  const names = (filters: Partial<typeof EMPTY_STAFF_REPORT_FILTERS>) => filterStaffReportRows(rows, { ...EMPTY_STAFF_REPORT_FILTERS, ...filters }).map((row) => row.name);

  it("searches names, barangays and report IDs", () => {
    expect(names({ query: "plaza" })).toEqual(["City Plaza"]);
    expect(names({ query: "landayan" })).toEqual(["Daisy Resort", "Balon ni Lolo"]);
    expect(names({})).toEqual(["Daisy Resort", "Echo Mall", "Acacia Park", "Balon ni Lolo", "City Plaza"]);
    expect(names({ query: "RPT-2026-10-a" })).toEqual(["Acacia Park"]);
  });

  it("filters by submission, staff review and barangay together", () => {
    expect(names({ submission: "Missing" })).toEqual(["Daisy Resort", "Echo Mall"]);
    expect(names({ review: "Waiting" })).toEqual(["Daisy Resort", "Echo Mall"]);
    expect(names({ review: "Reviewing" })).toEqual(["Acacia Park", "Balon ni Lolo"]);
    expect(names({ review: "Consolidated" })).toEqual(["City Plaza"]);
    expect(names({ submission: "Missing", barangay: "Landayan" })).toEqual(["Daisy Resort"]);
  });

  it("labels each option plainly, without a count", () => {
    const options = staffReportFilterOptions(rows);
    expect(options.submission).toEqual([
      { value: "all", label: "All submissions" },
      { value: "Missing", label: "Missing" },
      { value: "Pending", label: "Pending" },
      { value: "Submitted", label: "Submitted" },
    ]);
    expect(options.review.map(({ label }) => label)).toEqual(["All reviews", "Waiting", "Reviewing", "Consolidated"]);
    expect(options.barangay.map(({ value, label }) => [value, label])).toEqual([
      ["all", "All barangays"],
      ["Landayan", "Landayan"],
      ["Poblacion", "Poblacion"],
    ]);
    for (const option of [...options.submission, ...options.review, ...options.barangay]) expect(option).not.toHaveProperty("meta");
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

  it("counts the set filters for the phone Filters button, leaving the search out", () => {
    expect(activeStaffReportFilterCount(EMPTY_STAFF_REPORT_FILTERS)).toBe(0);
    expect(activeStaffReportFilterCount({ ...EMPTY_STAFF_REPORT_FILTERS, query: "plaza" })).toBe(0);
    expect(activeStaffReportFilterCount({ query: "", submission: "Missing", review: "all", barangay: "Landayan" })).toBe(2);
    expect(staffReportFiltersButtonLabel(0)).toBe("Filters");
    expect(staffReportFiltersButtonLabel(2)).toBe("Filters, 2 set");
  });
});

describe("reminders", () => {
  it("labels the button Remind, then Reminded once sent", () => {
    expect(reminderButton("Daisy Resort", false)).toEqual({ label: "Remind", ariaLabel: "Remind Daisy Resort" });
    expect(reminderButton("Daisy Resort", true)).toEqual({ label: "Reminded", ariaLabel: "Reminded Daisy Resort" });
  });

  it("confirms or reports the reminder with the enterprise and month", () => {
    expect(reminderSentMessage("Daisy Resort", "October 2026")).toBe("Reminder sent to Daisy Resort for October 2026.");
    expect(reminderFailedMessage("Daisy Resort", "October 2026")).toBe("The reminder to Daisy Resort for October 2026 could not be sent. Try again.");
  });
});

describe("the page caption", () => {
  it("names the reporting month and its due date", () => {
    expect(staffReportsCaption(october)).toBe("Reports for October 2026, due November 10. Accept each submitted report, then generate the consolidated report.");
    expect(staffReportsCaption({ month: "December", year: 2026 })).toBe("Reports for December 2026, due January 10, 2027. Accept each submitted report, then generate the consolidated report.");
  });
});

describe("generating the consolidated report", () => {
  it("waits while any received report is still being reviewed", () => {
    const rows = staffReportRows(enterprises, [report("a", "Pending Review"), report("b", "Pending Review"), report("c", "Ready to Consolidate")], october, afterDue);
    const progress = staffReportsProgress(rows);
    expect(progress).toMatchObject({ received: 3, consolidated: 1, reviewing: 2, waiting: 2, readyReportIds: ["r-c"], canGenerate: false, generated: false });
  });

  it("is ready once every received report is accepted, even when some enterprises have not sent one", () => {
    const rows = staffReportRows(enterprises, [report("a", "Ready to Consolidate"), report("b", "Consolidated")], october, beforeDue);
    const progress = staffReportsProgress(rows);
    expect(progress).toMatchObject({ canGenerate: true, readyReportIds: ["r-a"] });
    expect(progress.notSent.map((row) => row.enterpriseId)).toEqual(["c", "d", "e"]);
  });

  it("has nothing to generate when every received report is already in a monthly report, or none arrived", () => {
    const done = staffReportsProgress(staffReportRows([enterprise("a", "Acacia Park")], [report("a", "Consolidated")], october, afterDue));
    expect(done).toMatchObject({ canGenerate: false, generated: true });

    const none = staffReportsProgress(staffReportRows([enterprise("d", "Daisy Resort")], [], october, afterDue));
    expect(none).toMatchObject({ received: 0, canGenerate: false, generated: false });
  });
});

describe("the three report statuses", () => {
  it("uses only Missing, Pending and Submitted, and Waiting, Reviewing and Consolidated", () => {
    const rows = staffReportRows(enterprises, [report("a", "Pending Review"), report("b", "Ready to Consolidate"), report("c", "Consolidated")], october, afterDue);
    expect(new Set(rows.map((row) => row.submission))).toEqual(new Set(["Missing", "Submitted"]));
    expect(new Set(rows.map((row) => row.review))).toEqual(new Set(["Waiting", "Reviewing", "Consolidated"]));
    const before = staffReportRows(enterprises, [], october, beforeDue);
    expect(new Set(before.map((row) => row.submission))).toEqual(new Set(["Pending"]));
  });

  it("keeps the status filters in the address and ignores statuses that no longer exist", () => {
    const filters = parseStaffReportFilters(new URLSearchParams("submission=pending&review=consolidated"));
    expect(filters).toMatchObject({ submission: "Pending", review: "Consolidated" });
    expect(staffReportFilterParams(filters)).toMatchObject({ submission: "pending", review: "consolidated" });
    expect(parseStaffReportFilters(new URLSearchParams("submission=awaiting-correction&review=returned"))).toMatchObject({ submission: "all", review: "all" });
  });

  it("names the enterprises left out of the consolidated report", () => {
    expect(generateConfirmMessage("October 2026", { readyReportIds: ["r-a", "r-b"], notSent: [] })).toBe("Combine the 2 accepted reports into the October 2026 monthly report (VAR 2M).");
    const rows = staffReportRows(enterprises, [report("a", "Ready to Consolidate"), report("b", "Consolidated")], october, afterDue);
    expect(generateConfirmMessage("October 2026", staffReportsProgress(rows))).toBe(
      "Combine the 1 accepted report into the October 2026 monthly report (VAR 2M). 3 enterprises have not sent a report and will not be included.",
    );
  });

  it("reminds an enterprise to send its report, before or after the due date", () => {
    const [missing] = staffReportRows([enterprise("d", "Daisy Resort")], [], october, afterDue);
    expect(staffReminder(missing, "October 2026", "Nov 10")).toEqual({ title: "Monthly report reminder", message: "Please send your October 2026 monthly report. It was due Nov 10.", severity: "Warning" });
    const [pending] = staffReportRows([enterprise("d", "Daisy Resort")], [], october, beforeDue);
    expect(staffReminder(pending, "October 2026", "Nov 10")).toEqual({ title: "Monthly report reminder", message: "Please send your October 2026 monthly report by Nov 10.", severity: "Info" });
  });
});
