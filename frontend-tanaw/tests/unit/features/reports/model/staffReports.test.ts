import { describe, expect, it } from "vitest";
import {
  activeStaffReportFilterCount,
  compareStaffReportRows,
  consolidateButton,
  consolidatedMessage,
  draftReportNote,
  EMPTY_STAFF_REPORT_FILTERS,
  filterStaffReportRows,
  generateConfirmMessage,
  hasStaffReportFilters,
  INCOMPLETE_SUBMISSIONS_MESSAGE,
  INCOMPLETE_SUBMISSIONS_TITLE,
  incompleteSubmissionsDetail,
  openConsolidatedReport,
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
  const draft = { status: "Draft" as const };
  const finalized = { status: "Finalized" as const };

  it("counts the month's progress and is incomplete while any report is missing or being reviewed", () => {
    const rows = staffReportRows(enterprises, [report("a", "Pending Review"), report("b", "Pending Review"), report("c", "Ready to Consolidate")], october, afterDue);
    const progress = staffReportsProgress(rows);
    expect(progress).toMatchObject({ enterprises: 5, received: 3, consolidated: 1, reviewing: 2, waiting: 2, readyReportIds: ["r-c"], complete: false });
  });

  it("is complete once every enterprise sent a report and every report is accepted", () => {
    const rows = staffReportRows([enterprise("a", "Acacia Park"), enterprise("b", "Balon ni Lolo")], [report("a", "Ready to Consolidate"), report("b", "Consolidated")], october, afterDue);
    expect(staffReportsProgress(rows)).toMatchObject({ complete: true, readyReportIds: ["r-a"], notSent: [] });
    expect(staffReportsProgress(staffReportRows([enterprise("d", "Daisy Resort")], [], october, afterDue))).toMatchObject({ received: 0, complete: false });
  });

  it("can be generated once one report is accepted, warning first while the month is incomplete", () => {
    const rows = staffReportRows(enterprises, [report("a", "Ready to Consolidate"), report("b", "Pending Review")], october, afterDue);
    const progress = staffReportsProgress(rows);
    expect(consolidateButton(progress, undefined, "October 2026")).toEqual({ label: "Generate consolidated report", enabled: true, incomplete: true, reason: null });
    expect(progress.notSent.map((row) => row.enterpriseId)).toEqual(["c", "d", "e"]);
  });

  it("stays disabled, with the reason, until a report is accepted", () => {
    const reviewing = staffReportsProgress(staffReportRows(enterprises, [report("a", "Pending Review")], october, afterDue));
    expect(consolidateButton(reviewing, undefined, "October 2026")).toMatchObject({ enabled: false, reason: "Accept at least one report to generate the consolidated report." });
    const none = staffReportsProgress(staffReportRows(enterprises, [], october, afterDue));
    expect(consolidateButton(none, undefined, "October 2026")).toMatchObject({ enabled: false, reason: "No reports have been sent for October 2026 yet." });
  });

  it("updates a draft while the month is incomplete, and finalizes it once the month is complete", () => {
    const incomplete = staffReportsProgress(staffReportRows(enterprises, [report("a", "Consolidated"), report("b", "Ready to Consolidate")], october, afterDue));
    expect(consolidateButton(incomplete, draft, "October 2026")).toEqual({ label: "Update draft consolidated report", enabled: true, incomplete: true, reason: null });

    const nothingNew = staffReportsProgress(staffReportRows(enterprises, [report("a", "Consolidated"), report("b", "Pending Review")], october, afterDue));
    expect(consolidateButton(nothingNew, draft, "October 2026")).toEqual({ label: "Update draft consolidated report", enabled: false, incomplete: true, reason: "Accept another enterprise's report to update the draft." });

    const two = [enterprise("a", "Acacia Park"), enterprise("b", "Balon ni Lolo")];
    const complete = staffReportsProgress(staffReportRows(two, [report("a", "Consolidated"), report("b", "Ready to Consolidate")], october, afterDue));
    expect(consolidateButton(complete, draft, "October 2026")).toEqual({ label: "Generate consolidated report", enabled: true, incomplete: false, reason: null });

    // An enterprise that never reported was deactivated: the draft is finalized with nothing new.
    const allIn = staffReportsProgress(staffReportRows([enterprise("a", "Acacia Park")], [report("a", "Consolidated")], october, afterDue));
    expect(consolidateButton(allIn, draft, "October 2026")).toMatchObject({ label: "Generate consolidated report", enabled: true, incomplete: false });
  });

  it("cannot generate again once the month's report is final", () => {
    const progress = staffReportsProgress(staffReportRows([enterprise("a", "Acacia Park")], [report("a", "Consolidated")], october, afterDue));
    expect(consolidateButton(progress, finalized, "October 2026")).toEqual({ label: "Generate consolidated report", enabled: false, incomplete: false, reason: "The October 2026 consolidated report is final." });
  });

  it("finds the month's open consolidated report, skipping archived ones and other months", () => {
    const reports = [
      { id: "old", period: "October 2026", status: "Archived" as const },
      { id: "sep", period: "September 2026", status: "Finalized" as const },
      { id: "oct", period: "October 2026", status: "Draft" as const },
    ];
    expect(openConsolidatedReport(reports, october)?.id).toBe("oct");
    expect(openConsolidatedReport(reports, { month: "August", year: 2026 })).toBeUndefined();
  });

  it("notes the month's draft and when it last changed", () => {
    expect(draftReportNote("October 2026", { updatedAt: "2026-11-28T09:30:00+08:00", generatedOn: "2026-11-20" })).toBe("A draft consolidated report exists for October 2026, last updated Nov 28.");
  });
});

describe("the consolidation confirmations", () => {
  it("warns about incomplete submissions with the counts left out", () => {
    expect(INCOMPLETE_SUBMISSIONS_TITLE).toBe("Incomplete Report Submissions");
    expect(INCOMPLETE_SUBMISSIONS_MESSAGE).toBe("Some enterprises have not yet submitted their reports. Are you sure you want to proceed with the consolidation?");
    const eleven = Array.from({ length: 11 }, (_, index) => enterprise(`e${index}`, `Enterprise ${index}`));
    const reports = [
      ...eleven.slice(0, 6).map((item) => report(item.id, "Ready to Consolidate")),
      ...eleven.slice(6, 8).map((item) => report(item.id, "Pending Review")),
    ];
    const progress = staffReportsProgress(staffReportRows(eleven, reports, october, afterDue));
    expect(incompleteSubmissionsDetail(progress)).toBe("3 of 11 enterprises have not sent a report. 2 sent reports are still waiting for your review and will not be included.");
    expect(incompleteSubmissionsDetail({ enterprises: 4, notSent: [], reviewing: 1 })).toBe("1 sent report is still waiting for your review and will not be included.");
    expect(incompleteSubmissionsDetail({ enterprises: 4, notSent: progress.notSent.slice(0, 1), reviewing: 0 })).toBe("1 of 4 enterprises has not sent a report.");
  });

  it("adds accepted reports to a draft, or finalizes it with nothing new", () => {
    expect(generateConfirmMessage("October 2026", { readyReportIds: ["r-a"], notSent: [] }, true)).toBe("Add the 1 accepted report to the October 2026 draft and finalize the monthly report (VAR 2M).");
    expect(generateConfirmMessage("October 2026", { readyReportIds: [], notSent: [] }, true)).toBe("Every report for October 2026 is in the draft. Finalize the monthly report (VAR 2M).");
  });

  it("says whether the result is a new draft, an updated draft or the final report", () => {
    expect(consolidatedMessage("October 2026", "Draft", false)).toBe("A draft of the October 2026 consolidated report was saved.");
    expect(consolidatedMessage("October 2026", "Draft", true)).toBe("The October 2026 draft consolidated report was updated.");
    expect(consolidatedMessage("October 2026", "Finalized", true)).toBe("The October 2026 consolidated report was generated.");
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
