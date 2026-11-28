import { describe, expect, it } from "vitest";
import { isReturned, newerReport, reportDueDate, reportVersion, returnedNote, reviewStatus, submissionNote, submissionStatus } from "@/features/reports/model/reportStatuses";
import type { IntakeReport } from "@/shared/types";

function report(overrides: Partial<IntakeReport> = {}): IntakeReport {
  return { id: "r1", code: "RPT-2026-10-001", status: "Pending Review", submittedAt: "2026-11-06T09:00:00+08:00", submitted: "2026-11-06", month: "October", period: "October 2026", ...overrides } as IntakeReport;
}

describe("report due date", () => {
  it("is the 10th of the following month, including across a year", () => {
    expect(reportDueDate("October", 2026).toDateString()).toBe(new Date(2026, 10, 10).toDateString());
    expect(reportDueDate("December", 2026).toDateString()).toBe(new Date(2027, 0, 10).toDateString());
  });
});

describe("submission status", () => {
  it("is Submitted when a report exists, Pending before the due date and Missing after it", () => {
    expect(submissionStatus(report(), "October", 2026, new Date(2026, 10, 30))).toBe("Submitted");
    expect(submissionStatus(undefined, "October", 2026, new Date(2026, 10, 10, 18))).toBe("Pending");
    expect(submissionStatus(undefined, "October", 2026, new Date(2026, 10, 11))).toBe("Missing");
  });

  it("notes overdue and upcoming reports, but not a report that was sent", () => {
    expect(submissionNote(report({ submittedAt: "2026-11-13T10:00:00+08:00" }), "October", 2026, new Date(2026, 10, 20))).toBeNull();
    expect(submissionNote(report(), "October", 2026, new Date(2026, 10, 20))).toBeNull();
    expect(submissionNote(undefined, "October", 2026, new Date(2026, 10, 22))).toBe("12 days overdue");
    expect(submissionNote(undefined, "November", 2026, new Date(2026, 10, 22))).toBe("Due Dec 10");
  });
});

describe("staff review status", () => {
  it("is Waiting only while the enterprise has not sent a report", () => {
    expect(reviewStatus(undefined)).toBe("Waiting");
    expect(reviewStatus({ status: "Pending Review" })).not.toBe("Waiting");
  });

  it("maps a sent report to Reviewing until it is accepted, then Consolidated", () => {
    expect(reviewStatus({ status: "Pending Review" })).toBe("Reviewing");
    expect(reviewStatus({ status: "Ready to Consolidate" })).toBe("Consolidated");
    expect(reviewStatus({ status: "Consolidated" })).toBe("Consolidated");
  });
});

describe("returned reports", () => {
  const returned = report({ status: "Returned", returnedAt: "2026-11-12T10:00:00+08:00", returnedBy: "Maria Santos", returnedReason: "Recount the visitor origins." });

  it("count as awaiting correction, not submitted, and show Returned in staff review", () => {
    expect(submissionStatus(returned, "October", 2026, new Date(2026, 10, 30))).toBe("Awaiting correction");
    expect(reviewStatus(returned)).toBe("Returned");
    expect(isReturned(returned)).toBe(true);
    expect(isReturned(report())).toBe(false);
    expect(isReturned(undefined)).toBe(false);
  });

  it("note when they were returned, and who returned them and why", () => {
    expect(submissionNote(returned, "October", 2026, new Date(2026, 10, 20))).toBe("Returned Nov 12");
    expect(returnedNote(returned)).toBe("Returned on Nov 12 by Maria Santos: Recount the visitor origins.");
    expect(returnedNote({ returnedAt: null, returnedBy: null, returnedReason: null })).toBe("Returned.");
  });
});

describe("report versions", () => {
  it("prefer the higher version, then the one sent later", () => {
    const first = report({ id: "v1", version: 1, submittedAt: "2026-11-20T09:00:00+08:00" });
    const second = report({ id: "v2", version: 2, submittedAt: "2026-11-14T09:00:00+08:00" });
    expect(newerReport(first, second).id).toBe("v2");
    expect(newerReport(second, first).id).toBe("v2");
    expect(newerReport(undefined, first).id).toBe("v1");
    const resent = report({ id: "later", version: 1, submittedAt: "2026-11-21T09:00:00+08:00" });
    expect(newerReport(first, resent).id).toBe("later");
    // A report without a version is a first report.
    expect(reportVersion({ version: undefined as unknown as number })).toBe(1);
  });
});
