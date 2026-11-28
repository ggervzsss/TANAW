import { describe, expect, it } from "vitest";
import type { ReportRecord } from "../../../../../../src/types/enterprise";
import { REPORTING_STATUSES, REPORTING_STATUS_TONE, isSubmittedStatus, reportingStatus } from "../../../../../../src/features/reports/model/report-status";
import { formatReportingPeriodDueDate, isReportingPeriodOverdue } from "../../../../../../src/features/reports/model/reporting-calendar";

// Philippine time: October's report is due November 10, 2026.
const BEFORE_DUE = new Date("2026-11-06T04:00:00Z");
const DUE_DAY_EVENING = new Date("2026-11-10T14:00:00Z"); // 10:00 PM on Nov 10 in Manila
const AFTER_DUE = new Date("2026-11-10T16:30:00Z"); // 12:30 AM on Nov 11 in Manila

function report(overrides: Partial<ReportRecord> = {}): ReportRecord {
  return { id: "REP-1", date: "October 2026", period: "October 2026", status: "Submitted", entries: 1, unique: 1, syncStatus: "synced", ...overrides };
}

describe("reporting due date", () => {
  it("falls on the 10th of the next month, and passes at the end of that day in Philippine time", () => {
    expect(formatReportingPeriodDueDate("October 2026")).toBe("Nov 10, 2026");
    expect(formatReportingPeriodDueDate("December 2026")).toBe("Jan 10, 2027");
    expect(isReportingPeriodOverdue("October 2026", BEFORE_DUE)).toBe(false);
    expect(isReportingPeriodOverdue("October 2026", DUE_DAY_EVENING)).toBe(false);
    expect(isReportingPeriodOverdue("October 2026", AFTER_DUE)).toBe(true);
    expect(isReportingPeriodOverdue("Current Period", AFTER_DUE)).toBe(false);
  });
});

describe("reportingStatus", () => {
  it("lists Pending, Submitted, Missing and Consolidated, tinted amber, teal, red and green", () => {
    expect(REPORTING_STATUSES).toEqual(["Pending", "Submitted", "Missing", "Consolidated"]);
    expect(REPORTING_STATUS_TONE).toEqual({ Pending: "pending", Submitted: "submitted", Missing: "missing", Consolidated: "consolidated" });
    expect(REPORTING_STATUSES.filter(isSubmittedStatus)).toEqual(["Submitted", "Consolidated"]);
  });

  it("calls the open reporting period's draft Pending", () => {
    const draft = report({ id: "TANAW-DRAFT", status: "Draft", period: "November 2026", date: "November 2026", syncStatus: undefined });
    expect(reportingStatus("current", draft, AFTER_DUE)).toBe("Pending");
  });

  it("calls a month never sent Pending until its due date, and Missing after it", () => {
    expect(reportingStatus("pending", report({ status: "Draft" }), BEFORE_DUE)).toBe("Pending");
    expect(reportingStatus("pending", report({ status: "Draft" }), DUE_DAY_EVENING)).toBe("Pending");
    expect(reportingStatus("pending", report({ status: "Draft" }), AFTER_DUE)).toBe("Missing");
    // A draft saved for a closed month was still never sent.
    expect(reportingStatus("history", report({ status: "Draft", period: "June 2026", date: "June 2026" }), AFTER_DUE)).toBe("Missing");
  });

  it("calls a report TANAW received Submitted until Staff consolidate it, whatever the date", () => {
    expect(reportingStatus("history", report(), AFTER_DUE)).toBe("Submitted");
    expect(reportingStatus("history", report({ reviewStatus: "Pending Review" }), BEFORE_DUE)).toBe("Submitted");
    expect(reportingStatus("history", report({ reviewStatus: "Ready to Consolidate" }), AFTER_DUE)).toBe("Submitted");
  });

  it("does not call a report waiting to upload Submitted yet", () => {
    const waiting = report({ syncStatus: "pending_cloud_sync" });
    expect(reportingStatus("history", waiting, BEFORE_DUE)).toBe("Pending");
    expect(reportingStatus("history", waiting, AFTER_DUE)).toBe("Missing");
  });

  it("calls a consolidated report Consolidated, from its status or Staff's review", () => {
    expect(reportingStatus("history", report({ status: "Consolidated" }), AFTER_DUE)).toBe("Consolidated");
    expect(reportingStatus("history", report({ reviewStatus: "Consolidated" }), AFTER_DUE)).toBe("Consolidated");
  });

  it("calls a report TANAW refused Pending before the due date and Missing after, reopened or not", () => {
    const refused = report({ syncStatus: "upload_rejected" });
    expect(reportingStatus("history", refused, BEFORE_DUE)).toBe("Pending");
    expect(reportingStatus("history", refused, AFTER_DUE)).toBe("Missing");
    expect(reportingStatus("history", { ...refused, reopenedAt: "2026-11-06T00:00:00Z" }, AFTER_DUE)).toBe("Missing");
  });
});
